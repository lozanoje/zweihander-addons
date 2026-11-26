import { ATTACK_TARGETS_FLAG } from "./chat-target.mjs";
import { MODULE_ID } from "./targets.mjs";
import { reactionBlockedReason } from "./combat-rows.mjs";
import { clearReaction, confirmIfInsufficient, expectReaction, isTracked } from "./action-points.mjs";

/**
 * Esquivar / parar desde la tarjeta de ataque: el sistema engancha sus manejadores
 * en el elemento del mensaje (fase de burbujeo) y tira la reacción del token que esté
 * seleccionado. Aquí se intercepta el clic en fase de captura; si el usuario acepta,
 * se reenvía un clic marcado como aprobado que ya sigue el flujo normal del sistema.
 *
 * El punto de acción lo paga el primer objetivo del ataque (el token que recibió el
 * golpe), no el token seleccionado que tira la reacción. Si el ataque no tenía objetivo
 * guardado, paga el primer actor que tira.
 */
export function registerReactionCost() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.flags?.zweihander?.skillTestData?.testType !== "weapon") return;
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root || root.dataset.zwhAp) return;
    root.dataset.zwhAp = "1";
    root.addEventListener("click", (ev) => onClick(ev, message), true);
  });
}

/** Resultado de un crítico (ZweihanderDice.OUTCOME_TYPES.CRITICAL_SUCCESS). */
const CRITICAL_SUCCESS = 3;

/**
 * Un ataque con resultado crítico hace 1 dado de furia adicional de daño. El sistema ya lo
 * hace con su ajuste "extraFuryOnCrit"; si está desactivado, se añade aquí: se suma 1 a
 * "additionalFuryDice" de la configuración de la tirada solo mientras el sistema lanza el
 * daño (lo lee al empezar) y se restaura justo después.
 */
function boostCriticalFury(message) {
  const data = message.flags?.zweihander?.skillTestData;
  const config = data?.testConfiguration;
  if (data?.outcome !== CRITICAL_SUCCESS || !config) return;

  let systemHandlesIt = false;
  try {
    systemHandlesIt = game.settings.get("zweihander", "extraFuryOnCrit");
  } catch {
    // Ajuste inexistente en esta versión del sistema: se añade el dado aquí.
  }
  if (systemHandlesIt) return;

  const original = config.additionalFuryDice;
  config.additionalFuryDice = (original ?? 0) + 1;
  setTimeout(() => {
    if (original === undefined) delete config.additionalFuryDice;
    else config.additionalFuryDice = original;
  }, 0);
}

async function onClick(ev, message) {
  // Daño: la tirada de un crítico lleva un dado de furia adicional.
  const damageBtn = ev.target.closest?.(".skill-test-damage");
  if (damageBtn) {
    if (!damageBtn.disabled) boostCriticalFury(message);
    return;
  }

  const btn = ev.target.closest?.(".skill-test-parry, .skill-test-dodge");
  if (!btn || btn.disabled) return;

  // Un ataque localizado o crítico no se puede parar ni esquivar (tampoco desde la tarjeta del chat).
  const blocked = reactionBlockedReason(message);
  if (blocked) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    ui.notifications.warn(game.i18n.localize(blocked));
    return;
  }

  // Clic reenviado tras aprobar: dejar que lo gestione el sistema.
  if (btn.dataset.zwhApproved) {
    delete btn.dataset.zwhApproved;
    return;
  }

  ev.preventDefault();
  ev.stopImmediatePropagation();

  // Cada clic empieza de cero: una reacción anterior cuyo diálogo se canceló no debe cobrarse ahora.
  clearReaction();

  const rollers = reactingActors();
  const payer = attackTargetActor(message) ?? rollers[0] ?? null;

  if (rollers.length && isTracked(payer)) {
    const proceed = await confirmIfInsufficient([{ actor: payer, cost: 1 }]);
    if (!proceed) return;
    expectReaction(payer, rollers.map((a) => a.uuid), 1);
  }

  btn.dataset.zwhApproved = "1";
  btn.click();
}

/** Actor del primer objetivo guardado en la tarjeta de ataque. */
function attackTargetActor(message) {
  const first = message.getFlag(MODULE_ID, ATTACK_TARGETS_FLAG)?.[0];
  return first ? (fromUuidSync(first.uuid)?.actor ?? null) : null;
}

/** Actores que tirarán la reacción: los mismos que elige el sistema (determineCurrentActorUuids). */
function reactingActors() {
  const character = game.user.character;
  const controlled = canvas.tokens?.controlled ?? [];
  const uuids = new Set([
    ...(character && !game.user.isGM ? [character.uuid] : []),
    ...controlled.map((t) => t.actor?.uuid).filter(Boolean)
  ]);
  return Array.from(uuids, (uuid) => fromUuidSync(uuid)).filter(Boolean);
}
