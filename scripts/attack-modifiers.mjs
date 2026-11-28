import { MODULE_ID } from "./targets.mjs";

/**
 * Modificadores de un ataque con arma lanzado desde el tracker:
 *  - localizado: cuesta 2 PA (en vez de 1) y no se puede parar ni esquivar.
 *  - apuntado (aim 1 o 2): cuesta 1 o 2 PA más y da dificultad rutinaria (+10) o fácil (+20).
 *  - distancia (ver distance.mjs): el tramo de alcance (medio -10, largo y extremo -20) cambia la dificultad
 *    preseleccionada, a distancia extrema se quitan los dados de Furia, y un arma de Pólvora no se puede
 *    parar ni esquivar.
 */

/** Coste total en PA de un ataque. */
export const attackCost = ({ localized = false, aim = 0 } = {}) => (localized ? 2 : 1) + aim;

/** Bonificador a la prueba por apuntar: 1 PA = +10, 2 PA = +20. */
export const aimBonus = (aim) => aim * 10;

/** Ataque en curso (entre pulsar el arma y crearse la tarjeta de la tirada). */
let pending = null;

/**
 * @param {string} actorUuid
 * @param {object} [options]
 * @param {boolean} [options.localized]
 * @param {number} [options.aim]
 * @param {object|null} [options.range] Resultado de checkAttackDistance: { band, difficulty, noFury, gunpowder, furyAdjust }
 */
export function setPendingAttack(actorUuid, { localized = false, aim = 0, range = null } = {}) {
  pending = {
    actorUuid, localized, aim,
    band: range?.band, gunpowder: range?.gunpowder, noFury: range?.noFury,
    rangeDifficulty: range?.difficulty ?? 0, furyAdjust: range?.furyAdjust ?? 0
  };
}

/** Tiempo (ms) que una repetición espera a que se cree su tarjeta (con Mayús se abre un diálogo). */
const REROLL_TTL = 2 * 60 * 1000;

/**
 * "Volver a tirar" un ataque localizado o apuntado: la tarjeta nueva hereda esos modificadores
 * (si no, la repetición permitiría parar y esquivar un ataque localizado). Se gasta al crearse.
 */
export function setPendingReroll(actorUuid, info = {}) {
  pending = { actorUuid, ...info, reroll: true, until: Date.now() + REROLL_TTL };
}

export function clearPendingAttack() {
  pending = null;
}

export const getPendingAttack = () => pending;

/** Información del ataque guardada en la tarjeta de chat: { localized, aim, band, gunpowder, noFury } */
export const attackInfoOf = (message) => message?.getFlag?.(MODULE_ID, "attackInfo") ?? {};

export function registerAttackModifiers() {
  // Al crearse la tarjeta del ataque, se guardan en ella los modificadores (para el resto de usuarios y el tracker).
  Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
    if (userId !== game.user.id || !pending) return;
    if (pending.until && pending.until < Date.now()) {
      pending = null;
      return;
    }
    const test = message.flags?.zweihander?.skillTestData;
    if (test?.testType !== "weapon" || test.actorUuid !== pending.actorUuid) return;
    const { localized, aim, band, gunpowder, noFury, reroll } = pending;
    if (reroll) pending = null; // una repetición solo hereda una vez
    // Solo se guarda lo que tiene valor (el tracker lee estos datos para parar/esquivar y la furia).
    const info = Object.fromEntries(
      Object.entries({ localized, aim, band, gunpowder, noFury }).filter(([, value]) => value)
    );
    if (!Object.keys(info).length) return;
    message.updateSource({ [`flags.${MODULE_ID}.attackInfo`]: info });
  });

  // Al abrirse el diálogo de la tirada de arma se preselecciona la dificultad (apuntar y tramo de alcance)
  // y, a distancia extrema, se quitan los dados de Furia.
  Hooks.on("renderApplicationV2", (app, element) => {
    // En una repetición el diálogo (con Mayús) ya trae la dificultad de la tirada original.
    if (!pending || pending.reroll || app.zwhAimApplied) return;
    if (!pending.aim && !pending.rangeDifficulty && !pending.furyAdjust) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    const select = root?.querySelector?.('select[name="difficultyRatingSelect"]');
    const fury = root?.querySelector?.('[name="extraFury"]');
    // El diálogo de arma es el único de tirada con "dado de furia adicional".
    if (!select || !fury) return;

    app.zwhAimApplied = true;
    const difficulty = aimBonus(pending.aim) + (pending.rangeDifficulty ?? 0);
    if (difficulty) {
      select.value = String(Math.max(-30, Math.min(30, difficulty)));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (pending.furyAdjust) {
      fury.value = String(pending.furyAdjust); // quita los dados de la fórmula de daño: sin Furia
      fury.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}
