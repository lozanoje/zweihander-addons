import { ATTACK_TARGETS_FLAG } from "./chat-target.mjs";
import { MODULE_ID, applyStoredTargets } from "./targets.mjs";

/**
 * Estado local (por cliente) de las filas de combate del tracker:
 *  - visible: si las filas 2, 3 y 4 de un combatiente se muestran (botón espada). Por defecto, ocultas.
 *  - attackMsg / damageMsg / stressMsg: última tarjeta de ataque, de daño y de estrés (por pifia)
 *    del combatiente (filas 3, 4 y 5).
 *  - localized / aim: modificadores del próximo ataque (localizado, apuntar 1 o 2).
 *
 * Turnos: cuando le toca a un combatiente se borra su información de las filas 3 y 4 y se
 * muestran sus filas; cuando pierde el turno se ocultan, sin borrar nada.
 */
const visible = new Map();
const attackMsg = new Map();
const damageMsg = new Map();
const stressMsg = new Map();
const spellMsg = new Map();
/** Última tirada de contrahechizo contra cada tarjeta de hechizo: id del hechizo -> { outcome, messageId }. */
const counters = new Map();
/** Filas de magia (botón grimorio) visibles. */
const magicVisible = new Map();
/** Canalizar del próximo hechizo: 0 (no), 1, 2 o 3 pasos. */
const channel = new Map();
/** Modificadores del próximo ataque de cada combatiente. */
const localized = new Set();
const aim = new Map();
/**
 * Última tirada de parar/esquivar contra cada tarjeta de ataque:
 * id de la tarjeta de ataque -> { parry?: {outcome, messageId}, dodge?: {outcome, messageId} }
 * (outcome: 0 pifia ... 3 crítico).
 */
const reactions = new Map();
let activeCombatantId = null;

export const isVisible = (combatantId) => visible.get(combatantId) === true;

export const isMagicVisible = (combatantId) => magicVisible.get(combatantId) === true;

export function toggleMagicVisible(combatantId) {
  const next = !isMagicVisible(combatantId);
  magicVisible.set(combatantId, next);
  return next;
}

/** Canalizar: 0 = no, 1, 2 o 3 pasos (siempre 1 PA). */
export const channelLevel = (combatantId) => channel.get(combatantId) ?? 0;

/** Cada clic: 0 -> 1 -> 2 -> 3 -> 0. Devuelve el nuevo nivel. */
export function cycleChannel(combatantId) {
  const next = (channelLevel(combatantId) + 1) % 4;
  if (next) channel.set(combatantId, next);
  else channel.delete(combatantId);
  return next;
}

export function toggleVisible(combatantId) {
  const next = !isVisible(combatantId);
  visible.set(combatantId, next);
  return next;
}

export const isLocalized = (combatantId) => localized.has(combatantId);

export function toggleLocalized(combatantId) {
  if (localized.delete(combatantId)) return false;
  localized.add(combatantId);
  return true;
}

/** Apuntar: 0 = no, 1 = +10 (1 PA), 2 = +20 (2 PA). */
export const aimLevel = (combatantId) => aim.get(combatantId) ?? 0;

/** Cada clic: 0 -> 1 -> 2 -> 0. Devuelve el nuevo nivel. */
export function cycleAim(combatantId) {
  const next = (aimLevel(combatantId) + 1) % 3;
  if (next) aim.set(combatantId, next);
  else aim.delete(combatantId);
  return next;
}

/** Modificadores activos del combatiente, listos para pasar a rollWeaponAttack. */
export const modifiersOf = (combatantId) => ({ localized: isLocalized(combatantId), aim: aimLevel(combatantId) });

function resetModifiers(combatantId) {
  localized.delete(combatantId);
  aim.delete(combatantId);
  channel.delete(combatantId);
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
export const stressMessageOf = (combatantId) => game.messages.get(stressMsg.get(combatantId));
/** Resultado (0 pifia ... 3 crítico) del contrahechizo contra esa tarjeta de hechizo, si se ha tirado. */
export const counterOutcome = (spellMessageId) => counters.get(spellMessageId)?.outcome;

/** Anota el resultado de un contrahechizo (la tirada lleva el id del hechizo). Devuelve true si lo anotó. */
export function recordCounter(message) {
  const data = message.flags?.zweihander?.skillTestData;
  const spellId = data?.testConfiguration?.zwhCounterOf;
  if (!spellId) return false;
  counters.set(spellId, { outcome: data.outcome, messageId: message.id });
  return true;
}

export const spellMessageOf = (combatantId) => game.messages.get(spellMsg.get(combatantId));

const isTrackedMessage = (id) => [...attackMsg.values(), ...damageMsg.values(), ...stressMsg.values(), ...spellMsg.values()].includes(id);

/** Reinicia todo el estado (p. ej. al borrar el combate). */
export function resetCombatState() {
  visible.clear();
  attackMsg.clear();
  damageMsg.clear();
  stressMsg.clear();
  spellMsg.clear();
  counters.clear();
  magicVisible.clear();
  channel.clear();
  reactions.clear();
  localized.clear();
  aim.clear();
  activeCombatantId = game.combat?.combatant?.id ?? null;
}

/**
 * Cambia de turno: oculta al anterior (conservando sus filas 3 y 4), y al nuevo le
 * borra las filas 3 y 4 y le muestra sus filas.
 */
export function advanceTurn(nextCombatantId) {
  if (nextCombatantId === activeCombatantId) return false;
  if (activeCombatantId) {
    visible.set(activeCombatantId, false);
    magicVisible.set(activeCombatantId, false);
    resetModifiers(activeCombatantId); // localizado y apuntar valen para el turno en curso
  }
  if (nextCombatantId) {
    reactions.delete(attackMsg.get(nextCombatantId));
    attackMsg.delete(nextCombatantId);
    damageMsg.delete(nextCombatantId);
    stressMsg.delete(nextCombatantId);
    counters.delete(spellMsg.get(nextCombatantId));
    spellMsg.delete(nextCombatantId);
    resetModifiers(nextCombatantId);
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
  } else if (flags.skillTestData?.testType === "spell") {
    map = spellMsg;
    actorUuid = flags.skillTestData.actorUuid;
  } else if (flags.weaponTestData) {
    map = damageMsg;
    actorUuid = flags.weaponTestData.actorUuid;
  } else if (flags.madnessTestData) {
    map = stressMsg;
    actorUuid = flags.madnessTestData.target?.uuid;
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
    const countered = recordCounter(message);
    if (recorded || reacted || countered) onChange();
  });

  // Al editar (explotar, aplicar daño) o borrar una tarjeta seguida, o al (re)pintarla en el chat
  // (el sistema habilita sus botones al pintarla), el tracker debe reflejarlo.
  Hooks.on("updateChatMessage", (message) => isTrackedMessage(message.id) && onChange());
  Hooks.on("deleteChatMessage", (message) => isTrackedMessage(message.id) && onChange());
  Hooks.on("renderChatMessageHTML", (message) => isTrackedMessage(message.id) && onChange());

  Hooks.on("updateCombat", (combat, changes) => {
    if (combat.id !== game.combat?.id) return;
    if (!("turn" in changes) && !("round" in changes)) return;
    if (!advanceTurn(combat.combatant?.id ?? null)) return;

    // Al llegar su turno, los objetivos del lienzo pasan a ser los guardados en su token
    // (solo para quien controla ese token, para no tocar los targets del resto de jugadores).
    const token = combat.combatant?.token;
    if (token?.isOwner && game.settings.get(MODULE_ID, "canvasFollowsSelection")) applyStoredTargets(token);
    onChange();
  });

  Hooks.on("deleteCombat", () => {
    resetCombatState();
    onChange();
  });
}
