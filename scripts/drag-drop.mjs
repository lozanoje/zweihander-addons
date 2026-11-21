import { setSingleTarget } from "./targets.mjs";
import { rollWeaponAttack } from "./weapon-roll.mjs";

/** Tipo MIME propio: no choca con el arrastre de combatientes del tracker. */
const DRAG_MIME = "application/x-zweihander-addons-weapon";

/**
 * Arrastre en curso (el dataTransfer no se puede leer durante dragover):
 * combatiente y token que atacan, para no ofrecerse como destino a sí mismos.
 */
let dragging = null;

/** Convierte un botón de arma en arrastrable. */
export function makeWeaponDraggable(btn, weapon, combatant) {
  btn.draggable = true;
  btn.addEventListener("dragstart", (ev) => {
    // Evita que el tracker arrastre el combatiente completo (reordenar iniciativa).
    ev.stopPropagation();
    const tokenUuid = combatant.token?.uuid ?? null;
    dragging = { combatantId: combatant.id, tokenUuid };
    ev.dataTransfer.setData(DRAG_MIME, JSON.stringify({ uuid: weapon.uuid, tokenUuid }));
    ev.dataTransfer.effectAllowed = "copy";
  });
  btn.addEventListener("dragend", () => {
    dragging = null;
    setCanvasHover(null);
  });
}

/* ---------------------------------------------------------------- */
/*  Destino 1: otro contendiente del Combat Tracker                  */
/* ---------------------------------------------------------------- */

/** Hace que un <li> de combatiente acepte armas arrastradas. */
export function registerDropTarget(li, app) {
  if (li.dataset.zwhDrop) return; // ya registrado
  li.dataset.zwhDrop = "1";

  const accepts = (ev) =>
    ev.dataTransfer?.types?.includes(DRAG_MIME) && li.dataset.combatantId !== dragging?.combatantId;

  li.addEventListener("dragover", (ev) => {
    if (!accepts(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
    li.classList.add("zwh-drop-hover");
  });
  li.addEventListener("dragleave", (ev) => {
    if (!li.contains(ev.relatedTarget)) li.classList.remove("zwh-drop-hover");
  });
  li.addEventListener("drop", (ev) => {
    li.classList.remove("zwh-drop-hover");
    if (!accepts(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const raw = ev.dataTransfer.getData(DRAG_MIME);
    dragging = null;
    if (!raw) return;

    // El placeable solo existe si el token está en la escena que se está viendo.
    const combat = app.viewed ?? game.combat;
    const targetToken = combat?.combatants.get(li.dataset.combatantId)?.token?.object ?? null;
    performAttack(JSON.parse(raw), targetToken);
  });
}

/* ---------------------------------------------------------------- */
/*  Destino 2: tokens del lienzo                                     */
/* ---------------------------------------------------------------- */

let hoverToken = null;

/** Resalta (como al pasar el ratón) el token que hay bajo el arma arrastrada. */
function setCanvasHover(token) {
  if (token === hoverToken) return;
  hoverToken?._onHoverOut?.(new Event("hover"));
  token?._onHoverIn?.(new Event("hover"), { hoverOutOthers: true });
  hoverToken = token;
}

/** Punto del lienzo (coordenadas de escena) bajo el cursor. */
function canvasPoint(ev, board) {
  if (typeof canvas.canvasCoordinatesFromClient === "function") {
    return canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
  }
  const rect = board.getBoundingClientRect();
  return canvas.stage.worldTransform.applyInverse({
    x: ev.clientX - rect.left,
    y: ev.clientY - rect.top
  });
}

/** Token visible más alto bajo el cursor, excluyendo al que ataca. */
function tokenAt(ev, board) {
  if (!canvas.ready) return null;
  const point = canvasPoint(ev, board);
  const exclude = dragging?.tokenUuid;
  return (
    canvas.tokens.placeables
      .filter(
        (t) => t.visible && t.document.uuid !== exclude && t.bounds.contains(point.x, point.y)
      )
      .sort(
        (a, b) =>
          b.document.elevation - a.document.elevation || b.document.sort - a.document.sort
      )[0] ?? null
  );
}

/** Permite soltar armas sobre los tokens del lienzo. Llamar una vez (hook "ready"). */
export function registerCanvasDrop() {
  const board = document.getElementById("board") ?? canvas.app?.canvas;
  if (!board) return;

  const hasPayload = (ev) => ev.dataTransfer?.types?.includes(DRAG_MIME);

  board.addEventListener("dragover", (ev) => {
    if (!hasPayload(ev)) return;
    const token = tokenAt(ev, board);
    setCanvasHover(token);
    if (!token) return; // sin token debajo, el cursor indica que no se puede soltar
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
  });
  board.addEventListener("dragleave", () => setCanvasHover(null));
  board.addEventListener("drop", (ev) => {
    if (!hasPayload(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    setCanvasHover(null);
    const raw = ev.dataTransfer.getData(DRAG_MIME);
    const token = tokenAt(ev, board);
    dragging = null;
    if (raw && token) performAttack(JSON.parse(raw), token);
  });
}

/* ---------------------------------------------------------------- */
/*  Acción común: objetivo = token destino; después, el ataque       */
/* ---------------------------------------------------------------- */

async function performAttack({ uuid, tokenUuid }, targetToken) {
  const weapon = await fromUuid(uuid);
  if (!weapon?.actor?.isOwner) return;

  if (!targetToken) {
    ui.notifications.warn(game.i18n.localize("ZWH_ADDONS.NoTokenOnCanvas"));
    return;
  }

  const attackerDoc = tokenUuid ? await fromUuid(tokenUuid) : null;
  // El objetivo se fija después del aviso de puntos de acción: si dicen que no, no cambia nada.
  await rollWeaponAttack(weapon, { beforeRoll: () => setSingleTarget(targetToken, attackerDoc) });
}
