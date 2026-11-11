import { DEFAULT_CPU_ID, listCpus } from '../cpu/index.js';

// The opponent CPU, chosen by name on the battle setup screen (文豪, 2026-11-10: 「名前で選ぶ」). Which CPUs are shown,
// their names (a learned one with its generation) and their descriptions are the ones 文豪 set (2026-11-11, 「A」);
// whether one can be chosen is the CPU catalog's (src/cpu, listCpus available). One the catalog does not offer for these
// rules, or does not have yet (beatZIG before its weights are imported), is shown but cannot be chosen (準備中). The
// choice is kept in this browser.
export const CPU_CHOICE_KEY = 'simple-zeke.cpu';
const SHOWN = Object.freeze([
  { id: 'simple', name: 'simple', description: '決まった順で手を選ぶ、基本のCPU。' },
  { id: 'beatZIG', name: 'beatZIG gen3', description: '攻めを重く見る。先を読んで、STR の差を広げに来る。' },
  { id: 'lightZIG', name: 'lightZIG gen3', description: 'beatZIG の軽い版。先を読まないぶん、動きが速い。' }
]);
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// allowStale: a learned CPU of other rules counts as offered (?e2e=1&cpu-stale=1, for looking at the screen only).
export function cpuChoices({ allowStale = false } = {}) {
  const catalog = listCpus();
  return SHOWN.map(shown => {
    const entry = catalog.find(cpu => cpu.id === shown.id);
    return { ...shown, learned: entry?.learned ?? shown.id !== 'simple', available: Boolean(entry && (entry.available || (allowStale && entry.learned))) };
  });
}

// The kept choice when it can still be chosen, else the default.
export function readCpuChoice(storage, choices) {
  let id = null;
  try { id = storage?.getItem(CPU_CHOICE_KEY) ?? null; } catch { /* nothing kept */ }
  return choices.some(cpu => cpu.id === id && cpu.available) ? id : DEFAULT_CPU_ID;
}

export function saveCpuChoice(storage, id) {
  try { storage?.setItem(CPU_CHOICE_KEY, id); } catch { /* this page only */ }
}

// One radio per CPU: its name and its description; one not offered is shut and marked 準備中. The heading is the kind
// of CPU (the side above is already 相手（CPU）).
export function cpuPickerHtml(choices, selected) {
  const item = cpu => `<label class="r2-flow-cpu-item"${cpu.available ? '' : ' aria-disabled="true"'}><input type="radio" name="sz-ai-cpu" value="${esc(cpu.id)}" data-ai-cpu${cpu.id === selected ? ' checked' : ''}${cpu.available ? '' : ' disabled'}>`
    + `<span class="r2-flow-cpu-text"><b>${esc(cpu.name)}${cpu.available ? '' : '<small>準備中</small>'}</b><span>${esc(cpu.description)}</span></span></label>`;
  return `<fieldset class="r2-flow-cpu"><legend>CPUの種類</legend><div class="r2-flow-cpu-list">${choices.map(item).join('')}</div></fieldset>`;
}

// The short notice when the CPU of a match gives way to a lighter one (createCpu's switches; 文豪 2026-11-11: as
// proposed). from / to are the CPUs' shown names.
const REASONS = {
  slow: 'この端末では考える時間が長いため',
  'device-slow-before': 'この端末では前の対戦で考える時間が長かったため',
  error: 'うまく動かなかったため',
  'not-available': '今のルールでは使えないため',
  'not-loaded': '読み込めなかったため'
};
export function cpuSwitchText({ from, to, reason }) {
  const name = id => SHOWN.find(cpu => cpu.id === id)?.name ?? id;
  return `${REASONS[reason] ?? '都合により'}、相手のCPUを ${name(from)} から ${name(to)} に切り替えました。`;
}
