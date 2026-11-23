import { ATTACK_TARGETS_FLAG } from "./chat-target.mjs";
import { MODULE_ID } from "./targets.mjs";

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
/**
 * Última tirada de parar/esquivar contra cada tarjeta de ataque:
 * id de la tarjeta de ataque -> { parry?: {outcome, messageId}, dodge?: {outcome, messageId} }
 * (outcome: 0 pifia ... 3 crítico).
 */
const reactions = new Map();
let activeCombatantId = null;

export const isVisible = (combatantId) => visible.get(combatantId) === true;

export function toggleVisible(combatantId) {
  const next = !isVisible(combatantId);
  visible.set(combatantId, next);
  return next;
}

/** Resultado (0 pifia, 1 fallo, 2 éxito, 3 crítico) de la parada o esquiva contra esa tarjeta de ataque, si se ha tirado. */
export const reactionOutcome = (attackMessageId, kind) => reactions.get(attackMessageId)?.[kind]?.outcome;

/** Tarjeta de chat de la última parada/esquiva contra esa tarjeta de ataque (si sigue en el chat). */
export function reactionMessage(attackMessageId, kind) {
  const id = reactions.get(attackMessageId)?.[kind]?.messageId;
  return id ? game.messages.get(id) : undefined;
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
  reactions.clear();
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
    reactions.delete(attackMsg.get(nextCombatantId));
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

/** UUID del actor del primer objetivo guardado en una tarjeta de ataque. */
function firstTargetActorUuid(attackMessage) {
  const first = attackMessage.getFlag(MODULE_ID, ATTACK_TARGETS_FLAG)?.[0];
  return first ? fromUuidSync(first.uuid)?.actor?.uuid : undefined;
}

/**
 * Anota el resultado de una parada o esquiva en la tarjeta de ataque más reciente cuyo primer
 * objetivo es el actor que ha tirado. Sirve igual si se tira desde el tracker, desde la tarjeta
 * de chat o con "Volver a tirar". Devuelve true si lo anotó.
 */
export function recordReaction(message) {
  const data = message.flags?.zweihander?.skillTestData;
  if (!data || !["parry", "dodge"].includes(data.testType)) return false;

  const candidates = [...attackMsg.values()]
    .map((id) => game.messages.get(id))
    .filter((m) => m && firstTargetActorUuid(m) === data.actorUuid);
  if (!candidates.length) return false;

  const latest = candidates.reduce((a, b) => ((b.timestamp ?? 0) >= (a.timestamp ?? 0) ? b : a));
  reactions.set(latest.id, {
    ...reactions.get(latest.id),
    [data.testType]: { outcome: data.outcome, messageId: message.id }
  });
  return true;
}

/** @param {() => void} onChange Se llama cuando hay que volver a pintar el tracker. */
export function registerCombatState(onChange) {
  activeCombatantId = game.combat?.combatant?.id ?? null;

  Hooks.on("createChatMessage", (message) => {
    const recorded = recordMessage(message, game.combat);
    const reacted = recordReaction(message);
    if (recorded || reacted) onChange();
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
