import { buildRuntimeIdentityIndex } from './bridge.js';

// Private identity of a single synchronous read operation. No payload flag can mint it.
const reads = new WeakMap();

export function createRuntimeReadContext(engineState) {
  const context = Object.freeze({});
  reads.set(context, { engineState, index: null });
  return context;
}

export function runtimeReadIdentityIndex(engineState, context = null) {
  const read = context && reads.get(context);
  if (!read || read.engineState !== engineState) return buildRuntimeIdentityIndex(engineState);
  if (read.index === null) read.index = buildRuntimeIdentityIndex(engineState);
  return read.index;
}
