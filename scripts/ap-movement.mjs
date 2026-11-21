import { MODULE_ID } from "./targets.mjs";
import { confirmIfInsufficient, dbg, isTracked, spendAP } from "./action-points.mjs";

/** Campos de un waypoint que se pueden volver a enviar al relanzar el movimiento. */
const WAYPOINT_KEYS = [
  "x", "y", "elevation", "width", "height", "depth", "shape", "level",
  "action", "snapped", "explicit", "checkpoint"
];

/** IDs de movimientos ya cobrados (evita cobrar dos veces entre preMoveToken y moveToken). */
const charged = new Set();

function markCharged(id) {
  charged.add(id);
  if (charged.size > 50) charged.delete(charged.values().next().value);
}

/**
 * Coste de movimiento según los espacios recorridos y el movimiento M del actor
 * (system.stats.secondaryAttributes.movement.value):
 *   1..M -> 1 PA, M+1..2M -> 2 PA, 2M+1..3M -> 3 PA (y así sucesivamente).
 * Solo cuenta el movimiento arrastrando el token (method "dragging"): el de teclado
 * se hace casilla a casilla y cobraría 1 PA por cada pulsación.
 *
 * Se cobra en preMoveToken (donde se puede cancelar y preguntar). Si por lo que sea
 * ahí no se pudo medir, moveToken cobra una sola vez después, sin preguntar.
 */
export function registerMovementCost() {
  Hooks.on("preMoveToken", (tokenDoc, movement, operation) => {
    const result = evaluate(tokenDoc, movement, "preMoveToken");
    if (!result) return;
    const { actor, cost } = result;

    // Relanzado tras aceptar el aviso: se cobra y se deja pasar.
    if (operation?.zwhApApproved) {
      markCharged(movement.id);
      spendAP(actor, cost);
      return;
    }

    const ap = actor.system.stats.actionPoints;
    const warn = game.settings.get(MODULE_ID, "apWarning");
    if (cost <= ap.value || !warn) {
      // Con el aviso desactivado se mueve igualmente y los PA se quedan en 0.
      markCharged(movement.id);
      spendAP(actor, cost);
      return;
    }

    // PA insuficientes: se cancela este movimiento y, si aceptan, se relanza igual.
    askAndMove(tokenDoc, actor, cost, movement);
    return false;
  });

  Hooks.on("moveToken", (tokenDoc, movement, operation, user) => {
    if (user?.id !== game.user.id) return;
    if (charged.has(movement.id)) return;
    const result = evaluate(tokenDoc, movement, "moveToken");
    if (!result) return;
    markCharged(movement.id);
    spendAP(result.actor, result.cost);
  });
}

/** Devuelve { actor, cost } si este movimiento cuesta PA, o null. */
function evaluate(tokenDoc, movement, source) {
  if (movement.method !== "dragging") {
    dbg(`${source}: ignorado, método`, movement.method);
    return null;
  }

  const actor = tokenDoc.actor;
  if (!isTracked(actor)) {
    dbg(`${source}: ignorado, ${actor?.name ?? "sin actor"} no está en un combate iniciado`);
    return null;
  }

  const base = Number(actor.system?.stats?.secondaryAttributes?.movement?.value);
  if (!(base > 0)) {
    dbg(`${source}: ignorado, movimiento del actor =`, base);
    return null;
  }

  const spaces = movementSpaces(tokenDoc, movement);
  const cost = spaces > 0 ? Math.ceil(spaces / base) : 0;
  dbg(`${source}: ${actor.name} se mueve ${spaces} casillas (movimiento ${base}) -> ${cost} PA`, movement);
  return cost > 0 ? { actor, cost } : null;
}

/** Casillas recorridas: mediciones del propio movimiento y, si faltan, medición directa. */
function movementSpaces(tokenDoc, movement) {
  const spaces = (movement.passed?.spaces ?? 0) + (movement.pending?.spaces ?? 0);
  if (spaces > 0) return spaces;

  // Sin dato de casillas: distancia total entre la distancia por casilla de la escena.
  const distance = (movement.passed?.distance ?? 0) + (movement.pending?.distance ?? 0);
  if (distance > 0) return Math.round(distance / (canvas.scene?.grid?.distance || 1));

  // Último recurso: medir de origen a destino.
  try {
    return tokenDoc.measureMovementPath([movement.origin, movement.destination])?.spaces ?? 0;
  } catch (err) {
    dbg("no se pudo medir el movimiento", err);
    return 0;
  }
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
