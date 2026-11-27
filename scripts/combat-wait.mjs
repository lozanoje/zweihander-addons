/**
 * Espera: la acción de esperar no cuesta PA y permite bajar en la escalera de iniciativa.
 * El combatiente pasa a una iniciativa intermedia entre el siguiente y el posterior, y el turno
 * pasa al siguiente. Ejemplo: Conan 12 (turno), Brujin 10, Leonardo 4 -> Conan 7 y turno de Brujin.
 *
 * La iniciativa de un Combatant es un número sin restricción de enteros (CombatantData.initiative),
 * y Zweihander ya usa decimales (p. ej. 14.06), así que se puede poner un valor intermedio exacto.
 */

/**
 * Iniciativa a la que pasa quien espera.
 * @param {number} next   Iniciativa del siguiente contendiente
 * @param {number|undefined} after Iniciativa del contendiente que va detrás del siguiente (si lo hay)
 */
export function waitInitiative(next, after) {
  let value;
  if (!Number.isFinite(after)) value = next - 0.01; // el siguiente es el último: justo detrás de él
  else if (after === next) value = next - 0.001; // empate: no cabe un valor intermedio, justo detrás de ambos
  else value = (next + after) / 2;
  return Math.round(value * 1e6) / 1e6; // evita ruido de coma flotante
}

/**
 * @param {Combat} combat
 * @param {Combatant} combatant Quien espera (debe tener el turno)
 * @returns {Promise<boolean>} true si esperó
 */
export async function waitTurn(combat, combatant) {
  const warn = (key) => ui.notifications.warn(game.i18n.localize(key));

  if (!combat?.started || combat.combatant?.id !== combatant.id) {
    warn("ZWH_ADDONS.Wait.NotYourTurn");
    return false;
  }

  const turns = combat.turns;
  const index = turns.findIndex((t) => t.id === combatant.id);
  if (index === -1 || index === turns.length - 1) {
    warn("ZWH_ADDONS.Wait.NobodyAfter");
    return false;
  }

  // Siguiente que de verdad va a actuar: se saltan derrotados y sorprendidos, como hace el sistema.
  const skipDefeated = combat.settings?.skipDefeated;
  const surprised = [];
  let nextIndex = -1;
  for (let i = index + 1; i < turns.length; i++) {
    const t = turns[i];
    if (t.isDefeated && skipDefeated) continue;
    if (t.actor?.statuses?.has?.("surprised")) {
      surprised.push(t.actor);
      continue;
    }
    nextIndex = i;
    break;
  }
  if (nextIndex === -1) {
    warn("ZWH_ADDONS.Wait.AllSkipped");
    return false;
  }

  const next = turns[nextIndex];
  if (!Number.isFinite(next.initiative)) {
    warn("ZWH_ADDONS.Wait.NoInitiative"); // aún no ha tirado iniciativa: no hay con qué compararla
    return false;
  }

  const initiative = waitInitiative(next.initiative, turns[nextIndex + 1]?.initiative);
  await combatant.update({ initiative });

  // Los sorprendidos a los que se pasa por encima pierden la sorpresa, igual que al pasar turno.
  await combat._consumeSurprise?.(surprised);

  // Foundry reordena los turnos; el turno pasa al siguiente en su nueva posición.
  const target = combat.turns.findIndex((t) => t.id === next.id);
  if (target !== -1 && combat.turn !== target) await combat.update({ turn: target });
  return true;
}
