import { setSingleTarget } from "./targets.mjs";
import { rollWeaponAttack } from "./weapon-roll.mjs";

/** Tipo MIME propio: no choca con el arrastre de combatientes del tracker. */
const DRAG_MIME = "application/x-zweihander-addons-weapon";

/** Combatiente de origen del arrastre en curso (no se puede leer el dataTransfer en dragover). */
let draggingFrom = null;

/** Convierte un botón de arma en arrastrable. */
export function makeWeaponDraggable(btn, weapon, combatant) {
  btn.draggable = true;
  btn.addEventListener("dragstart", (ev) => {
    // Evita que el tracker arrastre el combatiente completo (reordenar iniciativa).
    ev.stopPropagation();
    draggingFrom = combatant.id;
    ev.dataTransfer.setData(DRAG_MIME, JSON.stringify({ uuid: weapon.uuid, combatantId: combatant.id }));
    ev.dataTransfer.effectAllowed = "copy";
  });
  btn.addEventListener("dragend", () => { draggingFrom = null; });
}

/** Hace que un <li> de combatiente acepte armas arrastradas. */
export function registerDropTarget(li, app) {
  if (li.dataset.zwhDrop) return; // ya registrado
  li.dataset.zwhDrop = "1";

  const accepts = (ev) =>
    ev.dataTransfer?.types?.includes(DRAG_MIME) && li.dataset.combatantId !== draggingFrom;

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
    draggingFrom = null;
    if (raw) onDropWeapon(JSON.parse(raw), li.dataset.combatantId, app);
  });
}

/** Objetivo = contendiente donde se suelta; después se lanza el ataque. */
async function onDropWeapon({ uuid, combatantId }, targetCombatantId, app) {
  const combat = app.viewed ?? game.combat;
  const targetCombatant = combat?.combatants.get(targetCombatantId);
  if (!targetCombatant) return;

  const weapon = await fromUuid(uuid);
  if (!weapon?.actor?.isOwner) return;

  // El placeable solo existe si el token está en la escena que se está viendo.
  const targetToken = targetCombatant.token?.object;
  if (!targetToken) {
    ui.notifications.warn(game.i18n.localize("ZWH_ADDONS.NoTokenOnCanvas"));
    return;
  }

  const attackerDoc = combat.combatants.get(combatantId)?.token;
  await setSingleTarget(targetToken, attackerDoc);
  await rollWeaponAttack(weapon);
}
