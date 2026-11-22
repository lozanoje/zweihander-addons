/**
 * Estado local (por cliente) de las filas de combate del tracker:
 *  - visible: si las filas 2, 3 y 4 de un combatiente se muestran (botón espada). Por defecto, ocultas.
 *  - attackMsg / damageMsg: última tarjeta de ataque y de daño del combatiente (filas 3 y 4).
 *
 * Turnos: cuando le toca a un combatiente se borra su información de las filas 3 y 4 y se
 * muestran sus filas; cuando pierde el turno se ocultan, sin borrar nada.
 */
const visible = new Map();
const attackMsg = new Map();
const damageMsg = new Map();
let activeCombatantId = null;

export const isVisible = (combatantId) => visible.get(combatantId) === true;

export function toggleVisible(combatantId) {
  const next = !isVisible(combatantId);
  visible.set(combatantId, next);
  return next;
}

/** Mensajes ya borrados del chat se consideran inexistentes. */
export const attackMessageOf = (combatantId) => game.messages.get(attackMsg.get(combatantId));
export const damageMessageOf = (combatantId) => game.messages.get(damageMsg.get(combatantId));

const isTrackedMessage = (id) => [...attackMsg.values(), ...damageMsg.values()].includes(id);

/** Reinicia todo el estado (p. ej. al borrar el combate). */
export function resetCombatState() {
  visible.clear();
  attackMsg.clear();
  damageMsg.clear();
  activeCombatantId = game.combat?.combatant?.id ?? null;
}

/**
 * Cambia de turno: oculta al anterior (conservando sus filas 3 y 4), y al nuevo le
 * borra las filas 3 y 4 y le muestra sus filas.
 */
export function advanceTurn(nextCombatantId) {
  if (nextCombatantId === activeCombatantId) return false;
  if (activeCombatantId) visible.set(activeCombatantId, false);
  if (nextCombatantId) {
    attackMsg.delete(nextCombatantId);
    damageMsg.delete(nextCombatantId);
    visible.set(nextCombatantId, true);
  }
  activeCombatantId = nextCombatantId ?? null;
  return true;
}

/** Anota un mensaje de chat en los combatientes del actor que lo ha lanzado. Devuelve true si lo anotó. */
export function recordMessage(message, combat) {
  const flags = message.flags?.zweihander;
  if (!flags || !combat) return false;

  let map, actorUuid;
  if (flags.skillTestData?.testType === "weapon") {
    map = attackMsg;
    actorUuid = flags.skillTestData.actorUuid;
  } else if (flags.weaponTestData) {
    map = damageMsg;
    actorUuid = flags.weaponTestData.actorUuid;
  } else {
    return false;
  }

  let found = false;
  for (const combatant of combat.combatants) {
    if (combatant.actor?.uuid !== actorUuid) continue;
    map.set(combatant.id, message.id);
    found = true;
  }
  return found;
}

/** @param {() => void} onChange Se llama cuando hay que volver a pintar el tracker. */
export function registerCombatState(onChange) {
  activeCombatantId = game.combat?.combatant?.id ?? null;

  Hooks.on("createChatMessage", (message) => {
    if (recordMessage(message, game.combat)) onChange();
  });

  // Al editar (explotar, aplicar daño) o borrar una tarjeta seguida, o al (re)pintarla en el chat
  // (el sistema habilita sus botones al pintarla), el tracker debe reflejarlo.
  Hooks.on("updateChatMessage", (message) => isTrackedMessage(message.id) && onChange());
  Hooks.on("deleteChatMessage", (message) => isTrackedMessage(message.id) && onChange());
  Hooks.on("renderChatMessageHTML", (message) => isTrackedMessage(message.id) && onChange());

  Hooks.on("updateCombat", (combat, changes) => {
    if (combat.id !== game.combat?.id) return;
    if (!("turn" in changes) && !("round" in changes)) return;
    if (advanceTurn(combat.combatant?.id ?? null)) onChange();
  });

  Hooks.on("deleteCombat", () => {
    resetCombatState();
    onChange();
  });
}
