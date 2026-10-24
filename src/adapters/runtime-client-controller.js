const failure = code => ({ ok: false, error: { code } });

function actionable(query) {
  if (query?.status?.finished === true) return false;
  if (query?.requiredInput?.canAnswer === true) return true;
  return query?.status?.progress === 'ready'
    && query.status.activeSeat === query.status.viewerSeat
    && Array.isArray(query.legalActions) && query.legalActions.length > 0;
}

export function createRuntimeClientController(input) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype
    || Reflect.ownKeys(input).length !== 3
    || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !['port', 'policy', 'scheduler'].includes(key))) {
    return failure('INVALID_RUNTIME_CLIENT_CONTROLLER');
  }
  const values = {};
  for (const key of ['port', 'policy', 'scheduler']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return failure('INVALID_RUNTIME_CLIENT_CONTROLLER');
    }
    values[key] = descriptor.value;
  }
  const { port, policy, scheduler } = values;
  if (!port || typeof port.query !== 'function' || typeof port.submit !== 'function'
    || typeof policy !== 'function' || !scheduler || typeof scheduler.schedule !== 'function'
    || typeof scheduler.cancel !== 'function') return failure('INVALID_RUNTIME_CLIENT_CONTROLLER');

  let disposed = false;
  let scheduled = null;
  let running = false;
  let serial = 0;

  const scheduleNext = () => {
    if (disposed || scheduled !== null) return false;
    let fired = false;
    const task = () => {
      if (fired) return;
      fired = true;
      scheduled = null;
      return !disposed ? step() : failure('RUNTIME_CLIENT_CONTROLLER_DISPOSED');
    };
    const token = scheduler.schedule(task);
    if (token === undefined || token === null) return false;
    scheduled = token;
    return true;
  };

  const step = () => {
    if (disposed) return failure('RUNTIME_CLIENT_CONTROLLER_DISPOSED');
    if (running) return failure('RUNTIME_CLIENT_CONTROLLER_BUSY');
    running = true;
    try {
      const before = port.query();
      if (!before.ok) return before;
      if (!actionable(before.value)) return { ok: true, value: { kind: 'idle', query: before.value } };
      const viewerSeat = before.value.status.viewerSeat;
      const commandId = `client:${viewerSeat}:${before.value.status.revision}:${++serial}`;
      const intent = policy(before.value, commandId, input => {
        if (disposed) return failure('RUNTIME_CLIENT_CONTROLLER_DISPOSED');
        return typeof port.queryAction === 'function' ? port.queryAction(input)
          : failure('ACTION_PLANNING_UNAVAILABLE');
      });
      if (!intent?.ok) return intent ?? failure('RUNTIME_CLIENT_POLICY_FAILED');
      if (disposed) return failure('RUNTIME_CLIENT_CONTROLLER_DISPOSED');
      const submitted = port.submit(intent.value);
      if (!submitted.ok) return submitted;
      const receipt = submitted.value?.receipt;
      const accepted = ['accepted', 'retry'].includes(submitted.value?.kind)
        && receipt?.status === 'accepted' && receipt.reasonCode === 'ACCEPTED';
      if (!accepted) {
        return { ok: true, value: { kind: 'stopped', receipt: submitted.value } };
      }
      const after = typeof port.latest === 'function' ? port.latest() : port.query();
      if (!after.ok) return after;
      const queued = actionable(after.value) ? scheduleNext() : false;
      return { ok: true, value: {
        kind: 'submitted', commandId, receipt: submitted.value,
        query: after.value, scheduled: queued
      } };
    } finally { running = false; }
  };

  return { ok: true, value: Object.freeze({
    start() {
      if (disposed) return failure('RUNTIME_CLIENT_CONTROLLER_DISPOSED');
      return { ok: true, value: { kind: scheduleNext() ? 'scheduled' : 'idle' } };
    },
    step,
    dispose() {
      if (!disposed) {
        disposed = true;
        if (scheduled !== null) scheduler.cancel(scheduled);
        scheduled = null;
      }
      return { ok: true, value: null };
    }
  }) };
}
