import { MISSING, STATE, dense, integer, number, own, reject, text } from './guards.js';

export function cardForCost(card) {
  const result = {};
  for (const key of ['id', 'name', 'category']) result[key] = text(own(card, key));
  const printed = own(card, 'printedCategory', true);
  if (printed !== MISSING && printed !== null) result.printedCategory = text(printed);
  const color = own(card, 'color', true);
  if (color !== MISSING && color !== null && color !== undefined) result.color = text(color);
  for (const key of ['cost', 'turnCostModifier', 'costReductionThisTurn', 'revealedExecutionCost']) {
    const value = own(card, key, true);
    if (value !== MISSING && value !== null && value !== undefined) result[key] = number(value);
  }
  const classes = own(card, 'classes', true);
  if (classes !== MISSING && classes !== null && classes !== undefined) result.classes = dense(classes).map(text);
  const faceDown = own(card, 'faceDown', true);
  if (faceDown !== MISSING && faceDown !== null && faceDown !== undefined) {
    if (typeof faceDown !== 'boolean') reject(STATE);
    result.faceDown = faceDown;
  } else result.faceDown = false;
  return result;
}

export function safeCostView(engineState, seats, viewerSeat) {
  const statePlayers = {};
  const enginePlayers = own(engineState, 'players');
  for (const id of ['player', 'ai']) {
    const source = own(enginePlayers, id);
    const sourceSeat = seats[id === 'player' ? 0 : 1];
    const user = own(source, 'user');
    const abilityKey = own(user, 'abilityKey');
    if (typeof abilityKey !== 'string') reject(STATE);
    const firstOb = own(source, 'firstObExecutionTurn', true);
    if (firstOb !== MISSING && firstOb !== null && !Number.isSafeInteger(firstOb)) reject(STATE);
    const player = {
      user: { abilityKey }, firstObExecutionTurn: firstOb === MISSING ? null : firstOb,
      front: [], back: [], registry: [], trash: []
    };
    for (const zone of ['front', 'back', 'registry', 'trash']) {
      const includeHidden = sourceSeat === viewerSeat && ['front', 'back'].includes(zone);
      for (const item of dense(own(source, zone))) {
        if (zone === 'trash') {
          if (sourceSeat === viewerSeat) player.trash.push({ name: text(own(item, 'name')) });
          continue;
        }
        const faceDown = own(item, 'faceDown', true);
        if (faceDown !== MISSING && faceDown !== null && faceDown !== undefined && typeof faceDown !== 'boolean') reject(STATE);
        if (faceDown === true && !includeHidden) continue;
        player[zone].push(cardForCost(item));
      }
    }
    statePlayers[id] = player;
  }
  const turnNumber = integer(own(engineState, 'turnNumber'), true);
  return { turnNumber, players: statePlayers };
}
