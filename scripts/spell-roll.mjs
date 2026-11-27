import { clearExpected, confirmIfInsufficient, expectSpend, isTracked } from "./action-points.mjs";
import { ATTACK_TARGETS_FLAG } from "./chat-target.mjs";
import { MODULE_ID } from "./targets.mjs";

/**
 * Magia: lanzar hechizos desde el tracker.
 *
 * El sistema lanza un hechizo con item.system.roll() (el mismo método que las armas), que abre
 * el diálogo «Configurar tirada: Encantamiento». Ese diálogo no admite parámetros, así que
 * (igual que con apuntar en las armas) las opciones se preseleccionan al pintarse el diálogo.
 */

/* ---------------------------------------------------------------- */
/*  Principios                                                       */
/* ---------------------------------------------------------------- */

const PRINCIPLES = ["generalist", "petty", "lesser", "greater"];

/** Nombres conocidos del principio en los idiomas del sistema (además de los de los archivos de idioma). */
const KNOWN_NAMES = {
  generalist: ["generalist", "generalista"],
  petty: ["petty", "pueril", "schwach"],
  lesser: ["lesser", "menor", "bescheiden"],
  greater: ["greater", "mayor", "mächtig"]
};

/** Coste en PA de lanzar un hechizo según su principio. */
export const SPELL_COST = { generalist: 1, petty: 1, lesser: 2, greater: 3 };

/** Dificultad por defecto de la tirada según el principio (la misma que usa el sistema en inglés). */
export const SPELL_DIFFICULTY = { generalist: 10, petty: 10, lesser: 0, greater: -10 };

/** Canalizar (1, 2 o 3 pasos) cuesta siempre 1 PA. */
export const CHANNEL_COST = 1;

/** Resultados de la tirada (ZweihanderDice.OUTCOME_TYPES): solo un éxito normal se puede contrahechizar. */
const SUCCESS = 2;
const CRITICAL = 3;

/** Clave de la tirada del contrahechizo que lleva el id del hechizo contrarrestado (se conserva al volver a tirar). */
export const COUNTER_OF = "zwhCounterOf";

/** Contrahechizo: 1 PA. */
export const COUNTERSPELL_COST = 1;

const normalize = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function principleNames(key) {
  const names = new Set(KNOWN_NAMES[key].map(normalize));
  const cap = key[0].toUpperCase() + key.slice(1);
  for (const path of [`ZWH_ADDONS.Principle.${cap}`, `ZWEI.rolls.principetypes.${key}`]) {
    const text = game.i18n.localize(path);
    if (text !== path) names.add(normalize(text));
  }
  return names;
}

/** Clave del principio del hechizo (generalist, petty, lesser, greater) sea cual sea el idioma, o null. */
export function principleKey(spell) {
  const value = normalize(spell?.system?.principle);
  if (!value) return null;
  for (const key of PRINCIPLES) if (principleNames(key).has(value)) return key;
  // «Magia Menor», «Principio mayor»...: se busca el nombre como palabra suelta.
  const words = value.split(/[^a-z]+/).filter(Boolean);
  for (const key of PRINCIPLES) {
    const names = principleNames(key);
    if (words.some((w) => names.has(w))) return key;
  }
  return null;
}

/** PA que cuesta lanzar el hechizo (sin canalizar). Si no se reconoce el principio, 1. */
export function spellCost(spell) {
  const key = principleKey(spell);
  if (!key) {
    console.warn(`zweihander-addons | principio desconocido en «${spell?.name}»: «${spell?.system?.principle}»`);
    return 1;
  }
  return SPELL_COST[key];
}

/** Coste total: principio + 1 si se canaliza (nivel 1, 2 o 3). */
export const castCost = (spell, channel = 0) => spellCost(spell) + (channel > 0 ? CHANNEL_COST : 0);

/* ---------------------------------------------------------------- */
/*  Preselección en el diálogo de tirada                             */
/* ---------------------------------------------------------------- */

/**
 * Tirada en curso: { kind: "spell"|"counter", actorUuid, channel, difficulty }.
 * Solo hay una a la vez por cliente.
 */
let pending = null;

function setSelect(root, name, value) {
  const select = root.querySelector(`select[name="${name}"]`);
  const option = select && [...select.options].find((o) => Number(o.value) === value);
  if (!option) return;
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

export function registerSpellDialog() {
  // La tirada del contrahechizo guarda el id del hechizo contrarrestado, para colorear su botón en el tracker.
  Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
    if (userId !== game.user.id || pending?.kind !== "counter") return;
    const test = message.flags?.zweihander?.skillTestData;
    if (test?.testType !== "skill" || test.actorUuid !== pending.actorUuid) return;
    message.updateSource({ [`flags.zweihander.skillTestData.testConfiguration.${COUNTER_OF}`]: pending.spellMessageId });
  });

  Hooks.on("renderApplicationV2", (app, element) => {
    if (!pending || app.zwhSpellApplied) return;
    if (app._skill?.actor?.uuid !== pending.actorUuid) return;

    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root?.querySelector?.('select[name="difficultyRatingSelect"]')) return;

    // El diálogo de hechizo es el único con «Canalizar poder».
    const isSpellDialog = !!root.querySelector('[name="channelSelect"]');
    const isWeaponDialog = !!root.querySelector('[name="extraFury"]');
    if (pending.kind === "spell" ? !isSpellDialog : isSpellDialog || isWeaponDialog) return;

    app.zwhSpellApplied = true;
    if (typeof pending.difficulty === "number") setSelect(root, "difficultyRatingSelect", pending.difficulty);
    if (pending.kind === "spell" && pending.channel) setSelect(root, "channelSelect", pending.channel * 10);
  });
}

/* ---------------------------------------------------------------- */
/*  Lanzar un hechizo                                                */
/* ---------------------------------------------------------------- */

/**
 * Lanza un hechizo como el botón de la ficha (diálogo «Configurar tirada» del sistema).
 *
 * Puntos de acción: coste según el principio (generalista y pueril 1, menor 2, mayor 3) más 1 si se
 * canaliza. Se restan cuando la tirada llega a crearse (si se cancela el diálogo no se cobra).
 *
 * @param {Item} spell
 * @param {object} [options]
 * @param {() => Promise<void>|void} [options.beforeRoll] Tras el aviso de PA y antes de abrir la tirada (fijar objetivo).
 * @param {number} [options.channel] Canalizar: 0 (no), 1, 2 o 3 pasos.
 */
export async function rollSpellCast(spell, { beforeRoll, channel = 0 } = {}) {
  const actor = spell.actor;
  const tracked = isTracked(actor);
  const cost = castCost(spell, channel);

  if (tracked && !(await confirmIfInsufficient([{ actor, cost }]))) return;

  await beforeRoll?.();

  if (tracked) expectSpend(actor, "spell", cost);
  const key = principleKey(spell);
  pending = {
    kind: "spell",
    actorUuid: actor.uuid,
    channel,
    difficulty: key ? SPELL_DIFFICULTY[key] : undefined
  };
  try {
    await spell.system.roll();
  } catch (err) {
    console.error("zweihander-addons | Error al lanzar el hechizo", err);
    ui.notifications.error(
      game.i18n.format("ZWEI.othermessages.noskillexists", {
        skill: actor.system?.stats?.secondaryAttributes?.magick?.associatedSkill ?? "?"
      })
    );
  } finally {
    pending = null;
    if (tracked) clearExpected(actor, "spell");
  }
}

/* ---------------------------------------------------------------- */
/*  Contrahechizo                                                    */
/* ---------------------------------------------------------------- */

/** Actor del primer objetivo guardado en la tarjeta del hechizo. */
export function spellTargetActor(message) {
  const first = message?.getFlag(MODULE_ID, ATTACK_TARGETS_FLAG)?.[0];
  return first ? (fromUuidSync(first.uuid)?.actor ?? null) : null;
}

/** Dificultad de la tirada del hechizo sin el bono de canalizar (la que se eligió en el diálogo). */
export const spellRawDifficulty = (message) =>
  Number(message?.flags?.zweihander?.skillTestData?.testConfiguration?.difficultyRating) || 0;

/** Dificultad contraria: -20 pasa a +20, +10 a -10. Limitada a los valores del diálogo (-30 a +30). */
export function counterDifficulty(message) {
  const raw = spellRawDifficulty(message);
  return raw === 0 ? 0 : Math.max(-30, Math.min(30, -raw));
}

/** Motivo (clave de traducción) por el que el hechizo no se puede contrahechizar por su resultado, o null. */
export function counterBlockedReason(message) {
  const outcome = message?.flags?.zweihander?.skillTestData?.outcome;
  if (outcome === CRITICAL) return "ZWH_ADDONS.Row.CounterspellCritical";
  if (outcome !== SUCCESS) return "ZWH_ADDONS.Row.CounterspellFailed";
  return null;
}

/**
 * ¿Puede el usuario contrahechizar este hechizo? Hace falta que el hechizo sea un éxito (no un crítico,
 * fallo ni pifia), que el objetivo sea usuario de magia, que el usuario controle a ese actor y que no
 * sea el propio lanzador.
 */
export function canCounterspell(message) {
  if (counterBlockedReason(message)) return false;
  const target = spellTargetActor(message);
  const caster = message?.flags?.zweihander?.skillTestData?.actorUuid;
  return !!target && target.system?.settings?.isMagickUser === true && target.isOwner && target.uuid !== caster;
}

/**
 * Contrahechizo: el objetivo del hechizo gasta 1 PA y hace una prueba de su habilidad de magia
 * (Encantamiento) con la dificultad contraria a la del hechizo.
 */
export async function rollCounterspell(spellMessage) {
  const actor = spellTargetActor(spellMessage);
  if (!actor || !canCounterspell(spellMessage)) {
    ui.notifications.warn(game.i18n.localize("ZWH_ADDONS.Row.Unavailable"));
    return;
  }

  const sheet = actor.sheet;
  if (typeof sheet?._onRollSkill !== "function") {
    console.error("zweihander-addons | la hoja del actor no tiene _onRollSkill");
    ui.notifications.error(game.i18n.localize("ZWH_ADDONS.Row.Unavailable"));
    return;
  }

  const tracked = isTracked(actor);
  if (tracked && !(await confirmIfInsufficient([{ actor, cost: COUNTERSPELL_COST }]))) return;

  if (tracked) expectSpend(actor, "counter", COUNTERSPELL_COST);
  pending = { kind: "counter", actorUuid: actor.uuid, spellMessageId: spellMessage.id, difficulty: counterDifficulty(spellMessage) };

  // Misma ruta que pulsar la habilidad en la hoja: busca la habilidad de magia del actor y abre el diálogo.
  const skill = actor.system?.stats?.secondaryAttributes?.magick?.associatedSkill;
  const event = {
    stopImmediatePropagation() {},
    stopPropagation() {},
    preventDefault() {},
    currentTarget: { dataset: { label: skill } }
  };
  try {
    await sheet._onRollSkill(event, CONFIG.ZWEI?.testTypes?.skill ?? "skill");
  } catch (err) {
    console.error("zweihander-addons | Error en el contrahechizo", err);
  } finally {
    pending = null;
    if (tracked) clearExpected(actor, "counter");
  }
}
