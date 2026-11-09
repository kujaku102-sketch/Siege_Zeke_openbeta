import { DEFAULT_CPU_ID, listCpus } from '../cpu/index.js';

// The opponent CPU, chosen by name on the battle setup screen (文豪, 2026-11-10: 「名前で選ぶ」). The names and their
// descriptions are the CPU catalog's own (src/cpu/catalog.js), shown as they are; one not offered for these rules
// (available: false) is shown but cannot be chosen. The choice is kept in this browser.
export const CPU_CHOICE_KEY = 'simple-zeke.cpu';
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// allowStale: a learned CPU of other rules counts as offered (?e2e=1&cpu-stale=1, for looking at the screen only).
export function cpuChoices({ allowStale = false } = {}) {
  return listCpus().map(cpu => ({ ...cpu, available: cpu.available || (allowStale && cpu.learned) }));
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

// One radio per CPU: its name and its description; one not offered is shut and marked 準備中.
export function cpuPickerHtml(choices, selected) {
  const item = cpu => `<label class="r2-flow-cpu-item"${cpu.available ? '' : ' aria-disabled="true"'}><input type="radio" name="sz-ai-cpu" value="${esc(cpu.id)}" data-ai-cpu${cpu.id === selected ? ' checked' : ''}${cpu.available ? '' : ' disabled'}>`
    + `<span class="r2-flow-cpu-text"><b>${esc(cpu.name)}${cpu.available ? '' : '<small>準備中</small>'}</b><span>${esc(cpu.description)}</span></span></label>`;
  return `<fieldset class="r2-flow-cpu"><legend>相手のCPU</legend><div class="r2-flow-cpu-list">${choices.map(item).join('')}</div></fieldset>`;
}

// The short notice when the CPU of a match gives way to a lighter one (createCpu's switches; wording provisional, for
// 文豪 to see). from / to are the CPUs' names.
const REASONS = {
  slow: 'この端末では考える時間が長いため',
  'device-slow-before': 'この端末では前の対戦で考える時間が長かったため',
  error: 'うまく動かなかったため',
  'not-available': '今のルールでは使えないため',
  'not-loaded': '読み込めなかったため'
};
export function cpuSwitchText({ from, to, reason }) {
  const name = id => listCpus().find(cpu => cpu.id === id)?.name ?? id;
  return `${REASONS[reason] ?? '都合により'}、相手のCPUを ${name(from)} から ${name(to)} に切り替えました。`;
}
