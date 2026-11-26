import { MODULE_ID, applyStoredTargets, getTargetIds, tokenImage } from "./targets.mjs";
import { rollWeaponAttack } from "./weapon-roll.mjs";
import { makeWeaponDraggable, registerDropTarget } from "./drag-drop.mjs";
import { canSeeStatus } from "./permissions.mjs";
import { aimLevel, cycleAim, isLocalized, isVisible, modifiersOf, toggleLocalized, toggleVisible } from "./combat-state.mjs";
import { buildAttackLine, buildDamageLine, buildStressLine } from "./combat-rows.mjs";
import { waitTurn } from "./combat-wait.mjs";
import { aimBonus } from "./attack-modifiers.mjs";

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
    li.querySelectorAll(".zwh-addons, .zwh-tracks, .zwh-combat-toggle").forEach((el) => el.remove());
    li.classList.remove("zwh-has-row", "zwh-has-tracks");

    const combatant = combat.combatants.get(li.dataset.combatantId);
    if (!combatant) return;

    // Cualquier combatiente puede recibir un arma arrastrada como objetivo.
    registerDropTarget(li, app);

    // Botón espada (Combate): muestra/oculta las filas 2, 3 y 4.
    addCombatToggle(li, combatant);

    // Marcadores de daño y estrés, en vertical a la derecha del retrato.
    const tracks = canSeeStatus(combatant.actor) ? buildTracks(combatant.actor) : null;
    if (tracks) {
      li.classList.add("zwh-has-tracks");
      li.append(tracks);
    }

    const row = buildRow(combatant, combat);
    if (!row) {
      if (tracks) watchLayout(li, () => placeTracks(li));
      return;
    }

    // Evita que los clics activen el combatiente.
    for (const type of ["click", "dblclick", "pointerdown"]) {
      row.addEventListener(type, (ev) => ev.stopPropagation());
    }

    li.classList.add("zwh-has-row");
    li.append(row);

    // Alinear la fila con el bloque del nombre y colocar los marcadores. Al abrir el mundo el
    // tracker aún no tiene layout (pestaña oculta / imágenes sin cargar), así que se mide ahora
    // y se vuelve a medir cada vez que cambia el tamaño del <li> o del retrato.
    watchLayout(li, () => alignRow(li, row));
  });
}

/** Ejecuta fn ahora y cada vez que cambie el tamaño del <li> o de su retrato. */
function watchLayout(li, fn) {
  fn();
  const observer = new ResizeObserver(fn);
  observer.observe(li);
  const img = li.querySelector(".token-image");
  if (img) observer.observe(img);
}

/**
 * Coloca los elementos que dependen de la geometría real del combatiente:
 *  - la segunda línea empieza donde empieza el nombre; los PA, si los hay, ocupan el hueco del
 *    retrato (centrados bajo él) y el resto de la fila arranca alineado con el nombre;
 *  - el marco llega hasta el borde derecho del combatiente (en algunos temas el contenido del
 *    <li> termina antes de donde se ve el borde, y la fila se quedaba corta);
 *  - el panel de daño y estrés queda justo a la derecha del retrato, en vertical.
 */
function alignRow(li, row) {
  const name = li.querySelector(".token-name");
  if (!name || !row.isConnected) return;

  // El panel de marcadores desplaza el nombre, así que va antes de medir.
  placeTracks(li, row);

  const nameRect = name.getBoundingClientRect();
  if (!nameRect.width) return; // oculto: el observer reintentará al mostrarse

  row.style.marginLeft = "0px";
  row.style.marginRight = "0px";
  const rowRect = row.getBoundingClientRect();
  const offset = Math.max(0, nameRect.left - rowRect.left);

  // Hasta el borde derecho visible del combatiente (menos un pequeño margen).
  const liRect = li.getBoundingClientRect();
  const edge = liRect.right - parseFloat(getComputedStyle(li).borderRightWidth || 0) - EDGE_GAP;
  const extra = Math.round(edge - rowRect.right);
  if (extra > 1) row.style.marginRight = `${-extra}px`;

  const lead = row.querySelector(":scope > .zwh-ap-lead");
  if (!lead) {
    row.style.marginLeft = `${offset}px`;
  } else {
    const imgWidth = li.querySelector(".token-image")?.getBoundingClientRect().width || 0;
    const width = imgWidth > 0 && imgWidth <= offset ? imgWidth : offset;
    lead.style.width = `${width}px`;
    lead.style.marginRight = `${offset - width}px`;
  }
}

/** Margen (px) entre el final de las filas y el borde del combatiente. */
const EDGE_GAP = 6;

/** Separación (px) del panel de marcadores con el borde superior del combatiente, el retrato y el nombre. */
const TRACKS_TOP = 3;
const TRACKS_GAP = 3;

/**
 * Panel de daño y estrés: justo a la derecha del retrato, en vertical. Empieza arriba del
 * combatiente y baja hasta el final de los PA (si los hay), repartiendo los cuadrados; el
 * nombre se aparta lo justo para no pisarlo.
 * @param {HTMLElement} li
 * @param {HTMLElement} [row] Segunda línea, si existe (para alinear con los PA)
 */
function placeTracks(li, row) {
  const panel = li.querySelector(":scope > .zwh-tracks");
  const img = li.querySelector(".token-image");
  const name = li.querySelector(".token-name");
  if (!panel || !img || !name) return;
  const imgRect = img.getBoundingClientRect();
  if (!imgRect.width) return; // oculto: el observer reintentará al mostrarse

  const liRect = li.getBoundingClientRect();
  const border = parseFloat(getComputedStyle(li).borderTopWidth || 0);
  const left = Math.round(imgRect.right - liRect.left + TRACKS_GAP);
  li.style.setProperty("--zwh-tracks-left", `${left}px`);
  li.style.setProperty("--zwh-tracks-top", `${TRACKS_TOP}px`);

  // Alto: el natural, o el necesario para llegar al final de los PA.
  panel.style.height = "";
  const natural = panel.getBoundingClientRect().height;
  const ap = row?.querySelector(".zwh-ap");
  if (ap) {
    const wanted = ap.getBoundingClientRect().bottom - (liRect.top + border + TRACKS_TOP);
    if (wanted > natural) panel.style.height = `${Math.round(wanted)}px`;
  }

  // El nombre empieza tras el panel.
  name.style.marginLeft = "0px";
  const panelRight = panel.getBoundingClientRect().right;
  const nameLeft = name.getBoundingClientRect().left;
  name.style.marginLeft = `${Math.max(0, Math.round(panelRight + TRACKS_GAP - nameLeft))}px`;
}

/**
 * Botón "Combate" (espada) justo después de "Resaltar ficha" en la primera fila.
 * Cada clic muestra u oculta el marco con las filas 2, 3 y 4.
 */
function addCombatToggle(li, combatant) {
  const controls = li.querySelector(".combatant-controls");
  if (!controls) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "inline-control combatant-control icon fa-solid fa-swords zwh-combat-toggle";
  btn.classList.toggle("active", isVisible(combatant.id));
  btn.dataset.tooltip = game.i18n.localize("ZWH_ADDONS.Combat");
  btn.setAttribute("aria-label", game.i18n.localize("ZWH_ADDONS.Combat"));

  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const shown = toggleVisible(combatant.id);
    btn.classList.toggle("active", shown);
    li.querySelector(".zwh-combat")?.classList.toggle("zwh-collapsed", !shown);
    // La fila vacía (sin PA ni marco visible) se oculta por CSS; el alto del <li> cambia solo.
  });

  const anchor =
    controls.querySelector('[data-action="pingCombatant"]') ??
    controls.querySelector('[data-action="toggleDefeated"]');
  if (anchor) anchor.after(btn);
  else controls.prepend(btn);
}

/**
 * Segunda línea del combatiente: [PA bajo el retrato] [marco gris con las filas 2, 3 y 4].
 *   fila 2: [diana] [targets] [espadas] [armas]
 *   fila 3: resultado de su último ataque y botones (solo si hay tarjeta de ataque)
 *   fila 4: último daño, marcador y botones (solo si hay tarjeta de daño)
 */
function buildRow(combatant, combat) {
  const row = document.createElement("div");
  row.className = "zwh-addons zwh-row";

  const ap = canSeeStatus(combatant.actor) ? buildActionPoints(combatant.actor) : null;

  const lines = [
    buildTargetsLine(combatant, combat),
    buildAttackLine(combatant),
    buildDamageLine(combatant),
    buildStressLine(combatant)
  ].filter(Boolean);
  if (!ap && !lines.length) return null;

  if (ap) {
    const lead = document.createElement("div");
    lead.className = "zwh-ap-lead";
    lead.append(ap);
    row.append(lead);
  }

  if (lines.length) {
    const frame = document.createElement("div");
    frame.className = "zwh-combat";
    frame.classList.toggle("zwh-collapsed", !isVisible(combatant.id));
    frame.append(...lines);
    row.append(frame);
  }
  return row;
}

/** Fila 2: objetivos, armas y, a su derecha, localizar, apuntar y esperar. */
function buildTargetsLine(combatant, combat) {
  const targets = buildTargets(combatant, combat);
  const weapons = buildWeapons(combatant);
  const modes = buildModeButtons(combatant, combat);
  if (!targets.length && !weapons.length && !modes.length) return null;

  const line = document.createElement("div");
  line.className = "zwh-line zwh-line-targets";
  if (targets.length) {
    line.append(icon("fa-solid fa-bullseye", "ZWH_ADDONS.Targets"), ...targets);
  }
  if (weapons.length) {
    line.append(icon("fa-solid fa-swords", "ZWH_ADDONS.Weapons"), ...weapons);
  }
  line.append(...modes);
  return line;
}

/* ---------------- Localizar, apuntar y esperar ---------------- */

/** Iconos de los botones de la fila 2 (cámbialos aquí si prefieres otros). */
const ICON_LOCALIZED = "fa-solid fa-head-side";
const ICON_AIM = "fa-solid fa-eye";
const ICON_WAIT = "fa-solid fa-arrow-down";

function modeButton(iconClasses, extraClass) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `zwh-mode inline-control ${extraClass}`;
  const i = document.createElement("i");
  i.className = iconClasses;
  btn.append(i);
  return btn;
}

/**
 * - Cabeza: ataque localizado (rojo al activarse): cuesta 2 PA y no se puede parar ni esquivar.
 * - Ojo: apuntar; cada clic cicla 1 (naranja, +10, 1 PA) -> 2 (rojo, +20, 2 PA) -> desactivado.
 * - Flecha abajo: esperar (sin coste de PA); solo en el turno del propio combatiente.
 * Solo para quien controla al combatiente.
 */
function buildModeButtons(combatant, combat) {
  if (!combatant.actor?.isOwner) return [];

  // Localizado
  const head = modeButton(ICON_LOCALIZED, "zwh-mode--localized");
  head.classList.toggle("active", isLocalized(combatant.id));
  head.dataset.tooltip = game.i18n.localize("ZWH_ADDONS.Mode.Localized");
  head.addEventListener("click", (ev) => {
    ev.stopPropagation();
    head.classList.toggle("active", toggleLocalized(combatant.id));
  });

  // Apuntar
  const aim = modeButton(ICON_AIM, "zwh-mode--aim");
  const badge = document.createElement("span");
  badge.className = "zwh-mode-badge";
  aim.append(badge);
  const paintAim = (level) => {
    aim.classList.toggle("aim-1", level === 1);
    aim.classList.toggle("aim-2", level === 2);
    aim.classList.toggle("active", level > 0);
    badge.textContent = level ? String(level) : "";
    aim.dataset.tooltip = level
      ? game.i18n.format("ZWH_ADDONS.Mode.AimLevel", { bonus: aimBonus(level), ap: level })
      : game.i18n.localize("ZWH_ADDONS.Mode.Aim");
  };
  paintAim(aimLevel(combatant.id));
  aim.addEventListener("click", (ev) => {
    ev.stopPropagation();
    paintAim(cycleAim(combatant.id));
  });

  // Esperar
  const wait = modeButton(ICON_WAIT, "zwh-mode--wait");
  wait.dataset.tooltip = game.i18n.localize("ZWH_ADDONS.Mode.Wait");
  wait.disabled = !(combat.started && combat.combatant?.id === combatant.id);
  wait.addEventListener("click", (ev) => {
    ev.stopPropagation();
    waitTurn(combat, combatant);
  });

  return [head, aim, wait];
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
      // El ataque va contra los objetivos que muestra la fila del combatiente (los guardados en su token).
      // Los modificadores (localizado, apuntar) son los que estén activados en ese momento.
      btn.addEventListener("click", () =>
        rollWeaponAttack(weapon, {
          beforeRoll: () => applyStoredTargets(combatant.token),
          ...modifiersOf(combatant.id)
        })
      );
      makeWeaponDraggable(btn, weapon, combatant);
    } else {
      btn.disabled = true;
    }
    return btn;
  });
}

/* ---------------- Puntos de acción, daño y estrés ---------------- */

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

/**
 * Daño (corazón) y estrés (ojo): dos columnas verticales, una por pista, con un cuadrado por estado.
 * Abajo el peor estado (abatido/incapacitado) y arriba el mejor; los verdes son los niveles que
 * quedan y el de abajo se pone naranja cuando el valor llega a 0.
 */
function buildTracks(actor) {
  const sa = actor.system?.stats?.secondaryAttributes;
  if (!sa?.damageCurrent && !sa?.perilCurrent) return null;

  const el = document.createElement("div");
  el.className = "zwh-tracks";

  if (sa.damageCurrent) {
    el.append(trackColumn("fa-solid fa-heart", sa.damageCurrent.value, DAMAGE_KEYS, "ZWEI.actor.secondary.damagetracker"));
  }
  if (sa.perilCurrent) {
    const alt = game.settings.get("zweihander", "alternativePerilSystem");
    el.append(trackColumn("fa-solid fa-eye", sa.perilCurrent.value, alt ? ALT_PERIL_KEYS : PERIL_KEYS, "ZWEI.actor.secondary.periltracker"));
  }
  return el;
}

function trackColumn(iconClasses, current, keys, titleKey) {
  const value = Math.min(Math.max(Math.round(current ?? 0), 0), keys.length - 1);
  const col = document.createElement("div");
  col.className = "zwh-track";
  col.dataset.tooltip = `${game.i18n.localize(titleKey)}: ${game.i18n.localize(`ZWEI.actor.conditions.${keys[value]}`)}`;

  // De arriba (mejor estado) a abajo (posición 0 = abatido/incapacitado).
  for (let n = keys.length - 1; n >= 0; n--) {
    const el = box(n >= 1 && n <= value);
    if (n === 0 && value === 0) el.classList.add("zwh-box--danger");
    col.append(el);
  }

  const i = document.createElement("i");
  i.className = `${iconClasses} zwh-track-icon`;
  col.append(i);
  return col;
}
