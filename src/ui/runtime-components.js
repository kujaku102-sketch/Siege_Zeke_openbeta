import { abilityBadgeDefinition } from "../data/ability-badges.js";
import { runtimeComponentRows } from "../data/component-rows.js";

// Read-only inspector projection. Never consume counters or change runtime state.
// The rows come from the runtime's own module; this adds the badge image of each ability.
export function runtimeComponents(card, turnNumber) {
  return runtimeComponentRows(card, turnNumber).map(({ label, value, note, abilityName, tone }) => ({
    label, value, note, abilityName, asset: abilityName ? abilityBadgeDefinition(abilityName).asset : null, tone
  }));
}

export function runtimeComponentRowsHtml(rows, escape) {
  if (!rows?.length) return '<p class="runtime-empty">付与・変動なし</p>';
  return `<ul class="component-list" aria-label="付与コンポーネントと能力残数">${rows.map(item => {
    const asset = item.abilityName ? abilityBadgeDefinition(item.abilityName).asset : null;
    return `<li class="component-tile ${item.tone ? `component-${escape(item.tone)}` : ''}">${asset ? `<img class="component-icon" src="${escape(asset)}" alt="" loading="lazy" decoding="async">` : ''}<span class="component-copy"><span class="component-heading"><span class="component-label">${escape(item.label)}</span>${item.value ? `<b>${escape(item.value)}</b>` : ''}</span>${item.note ? `<small>${escape(item.note)}</small>` : ''}</span></li>`;
  }).join('')}</ul>`;
}
