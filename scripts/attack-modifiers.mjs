import { MODULE_ID } from "./targets.mjs";

/**
 * Modificadores de un ataque con arma lanzado desde el tracker:
 *  - localizado: cuesta 2 PA (en vez de 1) y no se puede parar ni esquivar.
 *  - apuntado (aim 1 o 2): cuesta 1 o 2 PA más y da dificultad rutinaria (+10) o fácil (+20).
 */

/** Coste total en PA de un ataque. */
export const attackCost = ({ localized = false, aim = 0 } = {}) => (localized ? 2 : 1) + aim;

/** Bonificador a la prueba por apuntar: 1 PA = +10, 2 PA = +20. */
export const aimBonus = (aim) => aim * 10;

/** Ataque en curso (entre pulsar el arma y crearse la tarjeta de la tirada). */
let pending = null;

export function setPendingAttack(actorUuid, { localized = false, aim = 0 } = {}) {
  pending = { actorUuid, localized, aim };
}

export function clearPendingAttack() {
  pending = null;
}

export const getPendingAttack = () => pending;

/** Información del ataque guardada en la tarjeta de chat: { localized, aim } */
export const attackInfoOf = (message) => message?.getFlag?.(MODULE_ID, "attackInfo") ?? {};

export function registerAttackModifiers() {
  // Al crearse la tarjeta del ataque, se guardan en ella los modificadores (para el resto de usuarios y el tracker).
  Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
    if (userId !== game.user.id || !pending) return;
    const test = message.flags?.zweihander?.skillTestData;
    if (test?.testType !== "weapon" || test.actorUuid !== pending.actorUuid) return;
    const { localized, aim } = pending;
    if (!localized && !aim) return;
    message.updateSource({ [`flags.${MODULE_ID}.attackInfo`]: { localized, aim } });
  });

  // Al abrirse el diálogo de la tirada de arma, se preselecciona la dificultad por apuntar.
  Hooks.on("renderApplicationV2", (app, element) => {
    if (!pending?.aim || app.zwhAimApplied) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    const select = root?.querySelector?.('select[name="difficultyRatingSelect"]');
    // El diálogo de arma es el único de tirada con "dado de furia adicional".
    if (!select || !root.querySelector('[name="extraFury"]')) return;

    app.zwhAimApplied = true;
    select.value = String(aimBonus(pending.aim));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
