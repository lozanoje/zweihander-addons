import { MODULE_ID, getTargetIds, tokenImage } from "./targets.mjs";
import { rollWeaponAttack } from "./weapon-roll.mjs";
import { makeWeaponDraggable, registerDropTarget } from "./drag-drop.mjs";

/**
 * Armas que se muestran como botones:
 * - "character": solo las equipadas (system.equipped === true).
 * - Resto de tipos ("npc", "creature"): no tienen la etiqueta equipped, así que
 *   se muestran todos sus items de tipo "weapon".
 */
export function listedWeapons(actor) {
  const weapons = actor.items.filter((item) => item.type === "weapon");
  return actor.type === "character"
    ? weapons.filter((item) => item.system?.equipped === true)
    : weapons;
}

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
    li.querySelectorAll(".zwh-addons, .zwh-tracks").forEach((el) => el.remove());
    li.classList.remove("zwh-has-row", "zwh-has-tracks");

    const combatant = combat.combatants.get(li.dataset.combatantId);
    if (!combatant) return;

    // Cualquier combatiente puede recibir un arma arrastrada como objetivo.
    registerDropTarget(li, app);

    // Marcadores de daño y estrés, arriba a la derecha.
    const tracks = canSeeStatus(combatant.actor) ? buildTracks(combatant.actor) : null;
    if (tracks) {
      li.classList.add("zwh-has-tracks");
      li.append(tracks);
    }

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

/**
 * Sitúa la fila bajo el nombre: la fila empieza donde empieza el nombre.
 * Si lleva los PA bajo el retrato, ese bloque ocupa el hueco del retrato (centrado bajo él)
 * y el resto de la fila arranca alineado con el nombre; si no, se usa un margen izquierdo.
 */
function alignRow(li, row) {
  const name = li.querySelector(".token-name");
  if (!name || !row.isConnected) return;
  const nameRect = name.getBoundingClientRect();
  if (!nameRect.width) return; // oculto: el observer reintentará al mostrarse

  row.style.marginLeft = "0px";
  const offset = Math.max(0, nameRect.left - row.getBoundingClientRect().left);

  const lead = row.querySelector(":scope > .zwh-ap-lead");
  if (!lead) {
    row.style.marginLeft = `${offset}px`;
    return;
  }
  const imgWidth = li.querySelector(".token-image")?.getBoundingClientRect().width || 0;
  const width = imgWidth > 0 && imgWidth <= offset ? imgWidth : offset;
  lead.style.width = `${width}px`;
  lead.style.marginRight = `${offset - width}px`;
}

/* Fila única: [PA bajo el retrato] [diana] [targets] [espadas] [armas] */
function buildRow(combatant, combat) {
  const row = document.createElement("div");
  row.className = "zwh-addons zwh-row";

  const targets = buildTargets(combatant, combat);
  const weapons = buildWeapons(combatant);
  const ap = canSeeStatus(combatant.actor) ? buildActionPoints(combatant.actor) : null;
  if (!targets.length && !weapons.length && !ap) return null;

  if (ap) {
    const lead = document.createElement("div");
    lead.className = "zwh-ap-lead";
    lead.append(ap);
    row.append(lead);
  }

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

/* ---------------- Armas ---------------- */

function buildWeapons(combatant) {
  const actor = combatant.actor;
  if (!actor) return [];

  // Activado (por defecto): solo los propietarios ven las armas.
  // Desactivado: las ve todo el mundo, pero solo los propietarios pueden tirar.
  const ownersOnly = game.settings.get(MODULE_ID, "weaponsOwnersOnly");
  const isOwner = actor.isOwner;
  if (ownersOnly && !isOwner) return [];

  const max = game.settings.get(MODULE_ID, "nameMaxLength");
  return listedWeapons(actor).map((weapon) => {
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

/* ---------------- Puntos de acción, daño y estrés ---------------- */

/**
 * Estos datos solo se muestran a quien al menos observa al actor (el GM siempre),
 * para no revelar a los jugadores el estado de los PNJ.
 */
const canSeeStatus = (actor) => !!actor && actor.testUserPermission(game.user, "OBSERVER");

/** Claves de ZWEI.damageOptions / perilOptions / altPerilOptions (config.js del sistema). */
const DAMAGE_KEYS = ["slain", "grievously", "seriously", "moderately", "lightly", "unharmed"];
const PERIL_KEYS = ["incapacitated", "ignore3", "ignore2", "ignore1", "imperiled", "unhindered"];
const ALT_PERIL_KEYS = ["incapacitated", "penalty20", "penalty10", "penalty5", "imperiled", "unhindered"];

function box(on, extraClass = "") {
  const el = document.createElement("span");
  el.className = `zwh-box ${extraClass}${on ? " on" : ""}`.trim();
  return el;
}

/** Puntos de acción: cuadrados amarillos llenos = disponibles, vacíos = gastados. */
function buildActionPoints(actor) {
  const ap = actor.system?.stats?.actionPoints;
  if (!ap) return null;
  const value = Math.max(0, ap.value ?? 0);
  const total = Math.max(ap.max ?? 0, value);
  if (!total) return null;

  const el = document.createElement("div");
  el.className = "zwh-ap";
  el.dataset.tooltip = `${game.i18n.localize("ZWH_ADDONS.AP.Label")}: ${value}/${ap.max ?? total}`;
  for (let i = 0; i < total; i++) el.append(box(i < value, "zwh-box--ap"));
  return el;
}

/** Daño (corazón) y estrés (ojo): un cuadrado por estado; los verdes son los niveles que quedan y el primero se pone naranja en 0. */
function buildTracks(actor) {
  const sa = actor.system?.stats?.secondaryAttributes;
  if (!sa?.damageCurrent && !sa?.perilCurrent) return null;

  const el = document.createElement("div");
  el.className = "zwh-tracks";

  if (sa.damageCurrent) {
    el.append(trackRow("fa-solid fa-heart", sa.damageCurrent.value, DAMAGE_KEYS, "ZWEI.actor.secondary.damagetracker"));
  }
  if (sa.perilCurrent) {
    const alt = game.settings.get("zweihander", "alternativePerilSystem");
    el.append(trackRow("fa-solid fa-eye", sa.perilCurrent.value, alt ? ALT_PERIL_KEYS : PERIL_KEYS, "ZWEI.actor.secondary.periltracker"));
  }
  return el;
}

function trackRow(iconClasses, current, keys, titleKey) {
  const value = Math.min(Math.max(Math.round(current ?? 0), 0), keys.length - 1);
  const row = document.createElement("div");
  row.className = "zwh-track";
  row.dataset.tooltip = `${game.i18n.localize(titleKey)}: ${game.i18n.localize(`ZWEI.actor.conditions.${keys[value]}`)}`;

  const i = document.createElement("i");
  i.className = `${iconClasses} zwh-track-icon`;
  row.append(i);

  // Posición 0 = el peor estado (abatido/incapacitado): vacío mientras quede 1 o más,
  // naranja cuando el valor llega a 0. Las posiciones 1..valor van en verde.
  for (let n = 0; n < keys.length; n++) {
    const el = box(n >= 1 && n <= value);
    if (n === 0 && value === 0) el.classList.add("zwh-box--danger");
    row.append(el);
  }
  return row;
}
