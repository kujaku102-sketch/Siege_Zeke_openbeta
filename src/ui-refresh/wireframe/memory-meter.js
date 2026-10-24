// The memory gauge: the whole "く" frame holds ten cells, one per point of max
// memory. Lit cells are what is left to spend, open grey cells what has been
// spent, and cells past the max stay blank. While more than ten are left to
// spend, the surplus shows as "+N" above the frame.
// Presentation only.
export const METER_OUTER = 'M108 8H186L53 188 143 338H267V350H128L3 188Z';
export const CELLS = 10;
const GAP = 3, INSET = 6;
const round = n => Math.round(n * 10) / 10;
const quad = (y0, y1, left, right) => `M${round(left(y0))} ${round(y0)}H${round(right(y0))}L${round(right(y1))} ${round(y1)}H${round(left(y1))}Z`;
const slices = (from, to, count) => {
  const h = (to - from - GAP * (count - 1)) / count;
  return Array.from({ length:count }, (_, i) => [from + i * (h + GAP), from + i * (h + GAP) + h]);
};
// Upper arm: the frame's edges run from the top (108..186) down to the elbow (3..53).
const upperLeft = y => 108 - (y - 8) * (105 / 180) + INSET, upperRight = y => 186 - (y - 8) * (133 / 180) - INSET;
// Lower arm: the same lane the old five bars used.
const lowerLeft = y => 8 + (y - 190) * .7, lowerRight = y => lowerLeft(y) + 50;
const BAR = { left:172, right:260, top:307, bottom:337, slant:19 };

// Cells in fill order: from the bottom bar's right end, down the lower arm upward, then up the upper arm to its tip.
export const CELL_PATHS = Object.freeze((() => {
  const bar = [], w = (BAR.right - BAR.left - BAR.slant - GAP) / 2;
  for (let i = 0; i < 2; i++) {
    const a = BAR.left + i * (w + GAP);
    bar.push(`M${round(a)} ${BAR.top}H${round(a + w)}L${round(a + w + BAR.slant)} ${BAR.bottom}H${round(a + BAR.slant)}Z`);
  }
  const lower = slices(192, 337, 4).map(([a, b]) => quad(a, b, lowerLeft, lowerRight));
  const upper = slices(16, 184, 4).map(([a, b]) => quad(a, b, upperLeft, upperRight));
  return [...bar.reverse(), ...lower.reverse(), ...upper.reverse()];
})());

const count = value => Math.max(0, Math.floor(Number(value) || 0));
export function memoryMeterModel(memory) {
  const max = count(memory?.max), current = count(memory?.current);
  const cells = CELL_PATHS.map((d, i) => ({ d, state:i >= max ? 'blank' : i < current ? 'lit' : 'spent' }));
  const left = Math.min(current, max);
  return { cells, extra:left > CELLS ? left - CELLS : 0 };
}

const CELL_STYLE = {
  lit: 'fill="#00ff00" stroke="#00ff00"',
  spent: 'fill="none" stroke="#5b625d"',
  blank: 'fill="#232825" stroke="none"'
};
export function memoryMeterHtml(memory) {
  const { cells, extra } = memoryMeterModel(memory);
  const plus = extra ? `<text class="wf-meter-extra" x="147" y="-6" text-anchor="middle" fill="#00ff00" font-size="40" font-family="Georgia,serif">+${extra}</text>` : '';
  return `<svg class="wf-meter" viewBox="0 0 300 360" aria-hidden="true"><path d="${METER_OUTER}" fill="#191919" stroke="white" stroke-width="1.5"/>${cells.map(({ d, state }, i) => `<path data-mem-cell="${i}" data-mem-state="${state}" d="${d}" ${CELL_STYLE[state]} stroke-width="1.5"/>`).join('')}${plus}</svg>`;
}

// Which cells were just spent: the ones between the new and the old current value.
export function spentCells(before, after) {
  if (!before || !after || before.key !== after.key) return [];
  const from = Math.min(after.current, CELLS), to = Math.min(before.current, after.max, CELLS);
  return Array.from({ length:Math.max(0, to - from) }, (_, i) => from + i);
}

const FLASH_MS = 700;
// Spent cells flash white and fade to grey. The rule lives outside the patched
// tree so a re-render cannot drop it mid-flash.
export function createMemoryFlash(root) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc?.defaultView ?? globalThis;
  let last = null, sheet = null, timer = null;
  const stop = () => { if (timer !== null) win.clearTimeout(timer); timer = null; sheet?.remove(); sheet = null; };
  return Object.freeze({
    play(model, enabled) {
      const seat = model.seats.find(s => s.seatId === model.match.viewerSeat);
      const now = seat && { key:`${model.match.matchId}:${seat.seatId}`, current:count(seat.memory?.current), max:count(seat.memory?.max) };
      const cells = spentCells(last, now);
      last = now;
      if (!doc || !enabled || !cells.length || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      stop();
      sheet = doc.createElement('style'); sheet.dataset.fxMemory = '';
      sheet.textContent = cells.map(i => `.wf-meter [data-mem-cell="${i}"]`).join(',') + `{animation:wf-mem-spent ${FLASH_MS}ms ease-out}`;
      doc.head.append(sheet);
      timer = win.setTimeout(stop, FLASH_MS);
    },
    dispose() { stop(); last = null; }
  });
}
