import { MODULE_ID } from "./targets.mjs";
import { confirmIfInsufficient, isTracked, spendAP } from "./action-points.mjs";

/** Campos de un waypoint que se pueden volver a enviar al relanzar el movimiento. */
const WAYPOINT_KEYS = [
  "x", "y", "elevation", "width", "height", "depth", "shape", "level",
  "action", "snapped", "explicit", "checkpoint"
];

/**
 * Coste de movimiento según los espacios recorridos y el movimiento M del actor
 * (system.stats.secondaryAttributes.movement.value):
 *   1..M -> 1 PA, M+1..2M -> 2 PA, 2M+1..3M -> 3 PA (y así sucesivamente).
 * Solo cuenta el movimiento arrastrando el token (method "dragging"): el de teclado
 * se hace casilla a casilla y cobraría 1 PA por cada pulsación.
 */
export function registerMovementCost() {
  Hooks.on("preMoveToken", (tokenDoc, movement, operation) => {
    if (movement.method !== "dragging") return;

    const actor = tokenDoc.actor;
    if (!isTracked(actor)) return;

    const base = Number(actor.system?.stats?.secondaryAttributes?.movement?.value);
    if (!(base > 0)) return;

    const cost = apCost(movement.pending, base);
    if (cost <= 0) return;

    // Relanzado tras aceptar el aviso: se cobra y se deja pasar.
    if (operation.zwhApApproved) {
      spendAP(actor, cost);
      return;
    }

    const ap = actor.system.stats.actionPoints;
    if (cost <= ap.value) {
      spendAP(actor, cost);
      return;
    }

    // PA insuficientes: se cancela este movimiento y, si aceptan, se relanza igual.
    // Con el aviso desactivado se mueve igualmente y los PA se quedan en 0.
    if (!game.settings.get(MODULE_ID, "apWarning")) {
      spendAP(actor, cost);
      return;
    }
    askAndMove(tokenDoc, actor, cost, movement);
    return false;
  });
}

function apCost(section, base) {
  let spaces = section?.spaces;
  if (!spaces) {
    // Sin rejilla: se aproxima con la distancia y la distancia por casilla de la escena.
    const perSpace = canvas.scene?.grid?.distance || 1;
    spaces = Math.round((section?.distance ?? 0) / perSpace);
  }
  return spaces > 0 ? Math.ceil(spaces / base) : 0;
}

async function askAndMove(tokenDoc, actor, cost, movement) {
  const proceed = await confirmIfInsufficient([{ actor, cost }]);
  if (!proceed) return;

  const waypoints = (movement.pending?.waypoints ?? []).map((w) =>
    Object.fromEntries(WAYPOINT_KEYS.filter((k) => w[k] !== undefined).map((k) => [k, w[k]]))
  );
  if (!waypoints.length) return;

  await tokenDoc.move(waypoints, {
    method: movement.method,
    autoRotate: movement.autoRotate,
    showRuler: movement.showRuler,
    zwhApApproved: true
  });
}
