import { ATTACK_TARGETS_FLAG } from "./chat-target.mjs";
import { attackInfoOf } from "./attack-modifiers.mjs";
import { attackMessageOf, damageMessageOf, reactionMessage, reactionOutcome, stressMessageOf } from "./combat-state.mjs";
import { canSeeStatus } from "./permissions.mjs";
import { MODULE_ID, setCanvasTargets } from "./targets.mjs";

/** Claves de ZWEI.chatskill.* según el resultado numérico (0 = pifia ... 3 = crítico). */
const OUTCOME_KEYS = ["criticalfailure", "failure", "success", "criticalsuccess"];

/** Resultados: 0 pifia, 1 fallo, 2 éxito, 3 crítico (ZweihanderDice.OUTCOME_TYPES). */
const FAILURE = 1;
const SUCCESS = 2;
const CRITICAL = 3;

/* ---------------------------------------------------------------- */
/*  Marcador de daño frente al umbral de daño (UD)                   */
/* ---------------------------------------------------------------- */

/**
 * <= UD: corazón verde; UD+1..+6: 1 gota; UD+7..+12: 2 gotas; UD+13..+18: 3 gotas;
 * UD+19 en adelante: calavera.
 * @returns {{kind: "heart"|"drops"|"skull", count: number}}
 */
export function damageMarker(total, threshold) {
  if (total <= threshold) return { kind: "heart", count: 1 };
  const over = total - threshold;
  if (over <= 6) return { kind: "drops", count: 1 };
  if (over <= 12) return { kind: "drops", count: 2 };
  if (over <= 18) return { kind: "drops", count: 3 };
  return { kind: "skull", count: 1 };
}

/* ---------------------------------------------------------------- */
/*  Botones que activan los de la tarjeta de chat                    */
/* ---------------------------------------------------------------- */

/** Corta el texto de los botones al máximo de caracteres del ajuste (sin puntos suspensivos). */
const shorten = (text) => text.slice(0, game.settings.get(MODULE_ID, "buttonMaxLength"));

/** Botón de la tarjeta de chat (el sistema engancha sus acciones a esos botones). */
const chatButton = (messageId, selector) =>
  document.querySelector(`.chat-message[data-message-id="${messageId}"] ${selector}`);

/**
 * Botón del tracker que pulsa el de la tarjeta de chat. Así se ejecuta exactamente la
 * acción del sistema (y su aviso de puntos de acción). Se muestra desactivado cuando el
 * botón de la tarjeta lo está (permisos, daño ya aplicado, etc.).
 */
function proxyButton({ messageId, selector, icon, labelKey, before, result, reroll = false, blocked = null }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "zwh-btn inline-control";
  // Resultado de la tirada (parar/esquivar): el fondo toma el color del resultado del ataque.
  if (typeof result === "number") btn.classList.add(`zwh-result-${result}`);

  const i = document.createElement("i");
  i.className = icon;
  const label = document.createElement("span");
  const fullText = game.i18n.localize(labelKey);
  label.textContent = shorten(fullText);
  // Si es una repetición, el tooltip lo dice: usa fortuna igual que "Volver a tirar" del chat.
  btn.dataset.tooltip = reroll ? `${fullText} · ${game.i18n.localize("ZWEI.chatskill.goreroll")}` : fullText;
  // El botón mide lo que el texto; el icono se superpone en la esquina inferior derecha (por CSS).
  btn.append(label, i);

  // Acción que las reglas impiden (p. ej. parar un ataque localizado): gris y sin poder pulsarse.
  if (blocked) {
    btn.disabled = true;
    btn.classList.add("zwh-btn--blocked");
    btn.dataset.tooltip = `${fullText} · ${game.i18n.localize(blocked)}`;
    return btn;
  }

  const source = chatButton(messageId, selector);
  btn.disabled = !source || source.disabled;

  btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const current = chatButton(messageId, selector);
    if (!current || current.disabled) {
      ui.notifications.warn(game.i18n.localize("ZWH_ADDONS.Row.Unavailable"));
      return;
    }
    await before?.();
    current.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: ev.shiftKey }));
  });
  return btn;
}

/** Tokens objetivo guardados en la tarjeta de ataque. */
const attackTargets = (message) => message.getFlag(MODULE_ID, ATTACK_TARGETS_FLAG) ?? [];

/** Parar / esquivar: el sistema tira por el token seleccionado, así que se selecciona el objetivo del ataque. */
function controlAttackTarget(message) {
  const first = attackTargets(message)[0];
  const token = first ? fromUuidSync(first.uuid)?.object : null;
  if (token?.document?.isOwner) token.control({ releaseOthers: true });
}

/** Daño: el sistema toma los objetivos de los targets del usuario, así que se ponen los del ataque. */
function targetAttackTargets(message) {
  const ids = attackTargets(message).map((t) => fromUuidSync(t.uuid)?.id).filter(Boolean);
  if (ids.length) setCanvasTargets(ids);
}

/**
 * Motivo por el que el defensor no puede parar ni esquivar un ataque (clave de traducción), o null.
 * Un ataque localizado no se puede parar ni esquivar, y tampoco uno con resultado crítico.
 */
export function reactionBlockedReason(attackMessage) {
  if (attackInfoOf(attackMessage).localized) return "ZWH_ADDONS.Row.BlockedLocalized";
  if (attackMessage.flags?.zweihander?.skillTestData?.outcome === CRITICAL) return "ZWH_ADDONS.Row.BlockedCritical";
  return null;
}

/**
 * Parar / Esquivar. La primera vez tira la reacción (botón de la tarjeta de ataque, sobre el
 * objetivo). Si ya se ha tirado, el botón pasa a ser el "Volver a tirar" de la tarjeta de esa
 * tirada: así se comporta igual que en el chat (gasta fortuna o desgracia del Fortune Tracker y
 * no tira si no queda, reutiliza la dificultad y solo abre el diálogo con Mayús) y no cuesta PA.
 */
function reactionButton(attackMessage, kind, icon, labelKey) {
  const blocked = reactionBlockedReason(attackMessage);
  if (blocked) return proxyButton({ messageId: attackMessage.id, selector: `.skill-test-${kind}`, icon, labelKey, blocked });

  const previous = reactionMessage(attackMessage.id, kind);
  return previous
    ? proxyButton({
        messageId: previous.id, selector: ".skill-test-reroll", icon, labelKey,
        result: reactionOutcome(attackMessage.id, kind), reroll: true
      })
    : proxyButton({
        messageId: attackMessage.id, selector: `.skill-test-${kind}`, icon, labelKey,
        before: () => controlAttackTarget(attackMessage)
      });
}

/* ---------------------------------------------------------------- */
/*  Fila 3: tarjeta de ataque                                        */
/* ---------------------------------------------------------------- */

export function buildAttackLine(combatant) {
  const message = attackMessageOf(combatant.id);
  const data = message?.flags?.zweihander?.skillTestData;
  if (!data) return null;

  const outcome = data.outcome;
  const line = document.createElement("div");
  line.className = "zwh-line zwh-line-attack";

  const label = document.createElement("span");
  label.className = `zwh-outcome zwh-outcome-${outcome}`;
  label.textContent = game.i18n.localize(`ZWEI.chatskill.${OUTCOME_KEYS[outcome]}`);
  line.append(label);

  const messageId = message.id;
  if (outcome >= FAILURE) {
    line.append(
      proxyButton({ messageId, selector: ".skill-test-reroll", icon: "fas fa-rotate-right", labelKey: "ZWH_ADDONS.Row.Repeat" })
    );
  }
  if (outcome >= SUCCESS) {
    line.append(
      reactionButton(message, "parry", "ra ra-round-shield", "ZWH_ADDONS.Row.Parry"),
      reactionButton(message, "dodge", "ra ra-player-dodge", "ZWH_ADDONS.Row.Dodge"),
      proxyButton({
        messageId, selector: ".skill-test-damage", icon: "ra ra-sword", labelKey: "ZWH_ADDONS.Row.Damage",
        before: () => targetAttackTargets(message)
      })
    );
  }
  return line;
}

/* ---------------------------------------------------------------- */
/*  Fila 4: tarjeta de daño                                          */
/* ---------------------------------------------------------------- */

export function buildDamageLine(combatant) {
  const message = damageMessageOf(combatant.id);
  const data = message?.flags?.zweihander?.weaponTestData;
  if (!data) return null;

  const total = message.rolls?.[0]?.total;
  const line = document.createElement("div");
  line.className = "zwh-line zwh-line-damage";

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-hand-fist zwh-damage-icon";
  line.append(icon);

  const amount = document.createElement("strong");
  amount.className = "zwh-damage-total";
  amount.textContent = total ?? "?";
  line.append(amount);

  const marker = buildMarker(data, total);
  if (marker) line.append(marker);

  const messageId = message.id;
  line.append(
    proxyButton({ messageId, selector: ".damage-roll-explode", icon: "fas fa-burst", labelKey: "ZWH_ADDONS.Row.Explode" }),
    proxyButton({ messageId, selector: ".damage-roll-apply", icon: "fas fa-heart-crack", labelKey: "ZWH_ADDONS.Row.Apply" })
  );
  return line;
}

/** Iconos de los marcadores de daño y de estrés. */
const DAMAGE_ICONS = { heart: "fa-solid fa-heart", drops: "fa-solid fa-droplet", skull: "fa-solid fa-skull" };
const STRESS_ICONS = { heart: "fa-solid fa-brain", drops: "fa-solid fa-bolt", skull: "fa-solid fa-bed" };

/** Marcador frente al umbral de daño del primer objetivo (solo si el usuario puede ver su estado). */
function buildMarker(data, total) {
  const first = data.targets?.[0];
  const actor = first ? fromUuidSync(first.uuid) : null;
  const threshold = actor?.system?.stats?.secondaryAttributes?.damageThreshold?.value;
  return markerElement(actor, threshold, total, DAMAGE_ICONS, "damage");
}

/** Marcador frente al umbral de estrés del atacante (quien ha tenido la pifia). */
function buildStressMarker(target, total) {
  const actor = target?.uuid ? fromUuidSync(target.uuid) : null;
  const threshold = actor?.system?.stats?.secondaryAttributes?.perilThreshold?.value;
  return markerElement(actor, threshold, total, STRESS_ICONS, "stress");
}

function markerElement(actor, threshold, total, icons, family) {
  if (!canSeeStatus(actor) || typeof threshold !== "number" || typeof total !== "number") return null;

  const { kind, count } = damageMarker(total, threshold);
  const el = document.createElement("span");
  el.className = `zwh-marker zwh-marker-${family}-${kind}`;
  const label = family === "stress" ? "ZWH_ADDONS.Row.StressThreshold" : "ZWH_ADDONS.Row.Threshold";
  el.dataset.tooltip = `${game.i18n.localize(label)} (${actor.name}): ${threshold}`;

  for (let n = 0; n < count; n++) {
    const i = document.createElement("i");
    i.className = icons[kind];
    el.append(i);
  }
  return el;
}

/* ---------------------------------------------------------------- */
/*  Fila 5: tarjeta de estrés (pifia del atacante)                   */
/* ---------------------------------------------------------------- */

export function buildStressLine(combatant) {
  const message = stressMessageOf(combatant.id);
  const target = message?.flags?.zweihander?.madnessTestData?.target;
  if (!target) return null;

  const total = message.rolls?.[0]?.total;
  const line = document.createElement("div");
  line.className = "zwh-line zwh-line-stress";

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-face-dizzy zwh-damage-icon";
  line.append(icon);

  const amount = document.createElement("strong");
  amount.className = "zwh-damage-total";
  amount.textContent = total ?? "?";
  line.append(amount);

  const marker = buildStressMarker(target, total);
  if (marker) line.append(marker);

  // Solo "Aplicar", igual que la tarjeta del chat (el estrés no explota).
  line.append(
    proxyButton({ messageId: message.id, selector: ".skill-test-peril", icon: "fas fa-heart-crack", labelKey: "ZWH_ADDONS.Row.Apply" })
  );
  return line;
}
