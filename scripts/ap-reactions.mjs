import { confirmIfInsufficient, expectSpend, isTracked } from "./action-points.mjs";

/**
 * Esquivar / parar desde la tarjeta de ataque: el sistema engancha sus manejadores
 * en el elemento del mensaje (fase de burbujeo). Aquí se intercepta el clic en fase
 * de captura; si el usuario acepta, se reenvía un clic marcado como aprobado que ya
 * sigue el flujo normal del sistema.
 */
export function registerReactionCost() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.flags?.zweihander?.skillTestData?.testType !== "weapon") return;
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root || root.dataset.zwhAp) return;
    root.dataset.zwhAp = "1";
    root.addEventListener("click", onClick, true);
  });
}

async function onClick(ev) {
  const btn = ev.target.closest?.(".skill-test-parry, .skill-test-dodge");
  if (!btn || btn.disabled) return;

  // Clic reenviado tras aprobar: dejar que lo gestione el sistema.
  if (btn.dataset.zwhApproved) {
    delete btn.dataset.zwhApproved;
    return;
  }

  ev.preventDefault();
  ev.stopImmediatePropagation();

  const actors = reactingActors().filter(isTracked);
  const proceed = await confirmIfInsufficient(actors.map((actor) => ({ actor, cost: 1 })));
  if (!proceed) return;

  for (const actor of actors) expectSpend(actor, "reaction", 1);

  btn.dataset.zwhApproved = "1";
  btn.click();
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
