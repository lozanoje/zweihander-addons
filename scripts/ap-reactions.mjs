import { ATTACK_TARGETS_FLAG } from "./chat-target.mjs";
import { MODULE_ID } from "./targets.mjs";
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

async function onClick(ev, message) {
  const btn = ev.target.closest?.(".skill-test-parry, .skill-test-dodge");
  if (!btn || btn.disabled) return;

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
