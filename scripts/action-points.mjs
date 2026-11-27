import { MODULE_ID } from "./targets.mjs";

/**
 * Puntos de acción (PA): system.stats.actionPoints.value (actual) y .max (máximo).
 * Solo se contabilizan los de combatientes del combate activo y ya iniciado.
 */

/**
 * Diagnóstico: en la consola del navegador, CONFIG.debug.zweihanderAddons = true
 * activa mensajes que explican por qué se cobra (o no) cada acción.
 */
export function dbg(...args) {
  if (CONFIG.debug?.zweihanderAddons) console.log("zweihander-addons |", ...args);
}

/** Tiempo máximo (ms) que un gasto previsto espera a que se cree su tirada. */
const EXPECT_TTL = 2 * 60 * 1000;

/** Gastos previstos de ataque: "<uuid del actor>|weapon" -> { cost, until }. */
const expected = new Map();

/**
 * Reacción (esquivar/parar) en curso: la tira quien esté seleccionado (rollers) pero
 * el PA lo paga el objetivo del ataque (payer). Solo hay una a la vez por cliente.
 */
let pendingReaction = null;

export const apOf = (actor) => actor?.system?.stats?.actionPoints ?? null;

/** Combatiente del actor en el combate activo, si ya ha empezado. */
export function findCombatant(actor) {
  const combat = game.combat;
  if (!actor || !combat?.started) return null;
  return combat.combatants.find((c) => c.actor?.uuid === actor.uuid) ?? null;
}

/** ¿Hay que contabilizar los PA de este actor ahora mismo? */
export const isTracked = (actor) => !!apOf(actor) && !!findCombatant(actor);

const warningEnabled = () => game.settings.get(MODULE_ID, "apWarning");

const lacks = (actor, cost) => {
  const ap = apOf(actor);
  return !!ap && ap.value < cost;
};

/**
 * Si el aviso está activo y algún actor no tiene PA suficientes, pregunta si se
 * quiere continuar. Devuelve true si la acción puede seguir.
 * @param {{actor: Actor, cost: number}[]} entries
 */
export async function confirmIfInsufficient(entries) {
  if (!warningEnabled()) return true;
  const lacking = entries.filter(({ actor, cost }) => lacks(actor, cost));
  if (!lacking.length) return true;

  const title = `${game.i18n.localize("ZWH_ADDONS.AP.Title")}: ${lacking.map((e) => e.actor.name).join(", ")}`;
  const result = await foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<p>${game.i18n.localize("ZWH_ADDONS.AP.NotEnough")}</p>`,
    yes: { label: game.i18n.localize("ZWH_ADDONS.AP.Yes") },
    no: { label: game.i18n.localize("ZWH_ADDONS.AP.No"), default: true },
    rejectClose: false
  });
  return result === true;
}

/** Resta PA sin bajar de 0 (los PA temporales pueden superar el máximo). */
export async function spendAP(actor, cost) {
  const ap = apOf(actor);
  if (!ap || cost <= 0) return;
  const value = Math.max(0, ap.value - cost);
  if (value === ap.value) return;
  try {
    await actor.update({ "system.stats.actionPoints.value": value });
  } catch (err) {
    // Típicamente: este usuario no tiene permiso para modificar a ese actor.
    console.warn(`zweihander-addons | no se pudieron restar los PA de ${actor.name}`, err);
  }
}

/** Anota que cuando se cree la próxima tirada de ese tipo del actor hay que restar PA. */
export function expectSpend(actor, kind, cost = 1) {
  expected.set(`${actor.uuid}|${kind}`, { cost, until: Date.now() + EXPECT_TTL });
}

export function clearExpected(actor, kind) {
  expected.delete(`${actor.uuid}|${kind}`);
}

/**
 * Anota una reacción: cuando se cree la tirada de esquivar/parar de alguno de los
 * `rollerUuids`, se resta `cost` PA a `payer` (el objetivo del ataque).
 */
export function expectReaction(payer, rollerUuids, cost = 1) {
  pendingReaction = { payer, rollers: new Set(rollerUuids), cost, until: Date.now() + EXPECT_TTL };
}

/** Descarta una reacción anotada que no llegó a tirarse (diálogo cancelado). */
export function clearReaction() {
  pendingReaction = null;
}

/** Resultado de un crítico (ZweihanderDice.OUTCOME_TYPES.CRITICAL_SUCCESS). */
const CRITICAL_SUCCESS = 3;

function chargeReaction(rollerUuid, outcome) {
  const r = pendingReaction;
  if (!r || r.until < Date.now() || !r.rollers.has(rollerUuid)) return;
  pendingReaction = null;
  // Un crítico al parar o esquivar evita todo el daño y no gasta el PA de la reacción.
  if (outcome === CRITICAL_SUCCESS) return;
  spendAP(r.payer, r.cost);
}

/**
 * Cobra los gastos anotados en cuanto el sistema crea el mensaje de la tirada
 * (ataque con arma, esquivar o parar). Si el diálogo de tirada se cancela, no se cobra nada.
 */
export function registerSpendOnRoll() {
  Hooks.on("createChatMessage", (message, options, userId) => {
    if (userId !== game.user.id) return;
    const data = message.flags?.zweihander?.skillTestData;
    if (!data) return;

    // Esquivar/parar: paga el objetivo del ataque, no quien tira (ver expectReaction).
    if (["dodge", "parry"].includes(data.testType)) {
      chargeReaction(data.actorUuid, data.outcome);
      return;
    }
    // Ataque con arma, hechizo o contrahechizo (prueba de habilidad lanzada desde el botón del tracker).
    const kind = { weapon: "weapon", spell: "spell", skill: "counter" }[data.testType];
    if (!kind) return;

    const key = `${data.actorUuid}|${kind}`;
    const entry = expected.get(key);
    if (!entry) return;
    expected.delete(key);
    if (entry.until < Date.now()) return;

    const actor = fromUuidSync(data.actorUuid);
    if (actor) spendAP(actor, entry.cost);
  });
}
