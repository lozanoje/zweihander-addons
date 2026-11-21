import { MODULE_ID, getTargetIds } from "./targets.mjs";
import { rollWeaponAttack } from "./weapon-roll.mjs";
import { makeWeaponDraggable, registerDropTarget } from "./drag-drop.mjs";

const isEquippedWeapon = (item) =>
  item.type === "weapon" && item.system?.equipped === true;

const truncate = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * Estructura del tracker de Zweihander (src/templates/app/combat/tracker.hbs):
 *   li.combatant > img.token-image, .token-name, .token-resource, .token-initiative
 *
 * La fila se añade como último hijo del <li>, que pasa a poder partirse en líneas
 * (flex-wrap). Así la primera línea (imagen, nombre + iconos, valores) queda igual
 * que sin fila, y la fila ocupa toda la segunda línea hasta el final, alineada con
 * el nombre.
 */
export function onRenderCombatTracker(app, html) {
  const root = html instanceof HTMLElement ? html : html[0];
  const combat = app.viewed ?? game.combat;
  if (!root || !combat) return;

  root.querySelectorAll("li.combatant[data-combatant-id]").forEach((li) => {
    li.querySelector(".zwh-addons")?.remove();
    li.classList.remove("zwh-has-row");

    const combatant = combat.combatants.get(li.dataset.combatantId);
    if (!combatant) return;

    // Cualquier combatiente puede recibir un arma arrastrada como objetivo.
    registerDropTarget(li, app);

    const row = buildRow(combatant, combat);
    if (!row) return;

    // Evita que los clics activen el combatiente.
    for (const type of ["click", "dblclick", "pointerdown"]) {
      row.addEventListener(type, (ev) => ev.stopPropagation());
    }

    li.classList.add("zwh-has-row");
    li.append(row);

    // Sangría: alinear la fila con el bloque del nombre. Al abrir el mundo el tracker
    // aún no tiene layout (pestaña oculta / imágenes sin cargar), así que se mide
    // ahora y se vuelve a medir cada vez que cambia el tamaño del <li> o del retrato.
    alignRow(li, row);
    const observer = new ResizeObserver(() => alignRow(li, row));
    observer.observe(li);
    const img = li.querySelector(".token-image");
    if (img) observer.observe(img);
  });
}

/** Sitúa la fila bajo el nombre: margen izquierdo = posición del nombre - inicio de la fila. */
function alignRow(li, row) {
  const name = li.querySelector(".token-name");
  if (!name || !row.isConnected) return;
  const nameRect = name.getBoundingClientRect();
  if (!nameRect.width) return; // oculto: el observer reintentará al mostrarse
  row.style.marginLeft = "0px";
  const rowRect = row.getBoundingClientRect();
  row.style.marginLeft = `${Math.max(0, nameRect.left - rowRect.left)}px`;
}

/* Fila única: [diana] [targets] [espadas] [armas] */
function buildRow(combatant, combat) {
  const row = document.createElement("div");
  row.className = "zwh-addons zwh-row";

  const targets = buildTargets(combatant, combat);
  const weapons = buildWeapons(combatant);
  if (!targets.length && !weapons.length) return null;

  if (targets.length) {
    row.append(icon("fa-solid fa-bullseye", "ZWH_ADDONS.Targets"), ...targets);
  }
  if (weapons.length) {
    row.append(icon("fa-solid fa-swords", "ZWH_ADDONS.Weapons"), ...weapons);
  }
  return row;
}

function icon(classes, tooltipKey) {
  const i = document.createElement("i");
  i.className = `${classes} zwh-icon`;
  i.dataset.tooltip = game.i18n.localize(tooltipKey);
  return i;
}

/* ---------------- Targets ---------------- */

function buildTargets(combatant, combat) {
  // combat.scene puede ser null (combates no ligados a una escena): se usa la
  // escena del propio token, que es siempre la que lo contiene.
  const sourceDoc = combatant.token ?? canvas.scene?.tokens.get(combatant.tokenId);
  const scene = sourceDoc?.parent ?? combat.scene;
  if (!sourceDoc || !scene) return [];

  const sameScene = scene.id === canvas.scene?.id;
  const entries = [];

  for (const id of getTargetIds(sourceDoc)) {
    const targetDoc = scene.tokens.get(id);
    if (!targetDoc) continue;

    const entry = document.createElement("span");
    entry.className = "zwh-target";

    const img = document.createElement("img");
    img.src = tokenImage(targetDoc);
    img.alt = targetDoc.name;
    img.dataset.tooltip = targetDoc.name;
    entry.append(img);

    const token = sameScene ? targetDoc.object : null;
    entry.addEventListener("pointerenter", () => token?._onHoverIn?.(new Event("hover")));
    entry.addEventListener("pointerleave", () => token?._onHoverOut?.(new Event("hover")));
    entry.addEventListener("click", () => {
      if (token) canvas.animatePan({ x: token.center.x, y: token.center.y });
    });

    entries.push(entry);
  }
  return entries;
}

/** Evita usar vídeos (webm/mp4) como <img>. */
function tokenImage(doc) {
  const src = doc.texture?.src ?? "";
  return /\.(webm|mp4|m4v)$/i.test(src) ? (doc.actor?.img ?? "icons/svg/mystery-man.svg") : src;
}

/* ---------------- Armas equipadas ---------------- */

function buildWeapons(combatant) {
  const actor = combatant.actor;
  if (!actor) return [];

  // Activado (por defecto): solo los propietarios ven las armas.
  // Desactivado: las ve todo el mundo, pero solo los propietarios pueden tirar.
  const ownersOnly = game.settings.get(MODULE_ID, "weaponsOwnersOnly");
  const isOwner = actor.isOwner;
  if (ownersOnly && !isOwner) return [];

  const max = game.settings.get(MODULE_ID, "nameMaxLength");
  return actor.items.filter(isEquippedWeapon).map((weapon) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zwh-weapon inline-control";
    btn.textContent = truncate(weapon.name, max);
    btn.dataset.tooltip = weapon.name;
    if (isOwner) {
      btn.addEventListener("click", () => rollWeaponAttack(weapon));
      makeWeaponDraggable(btn, weapon, combatant);
    } else {
      btn.disabled = true;
    }
    return btn;
  });
}
