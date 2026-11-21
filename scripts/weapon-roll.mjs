import { clearExpected, confirmIfInsufficient, expectSpend, isTracked } from "./action-points.mjs";

/**
 * Lanza la tirada de ataque de un arma exactamente como el botón de la ficha:
 * abre el diálogo "Configurar tirada" del sistema Zweihander.
 *
 * El sistema lo implementa en item.system.roll() (ZweihanderBaseItemModel), que
 * localiza la habilidad asociada al arma y llama a rollTest(..., { showDialog: true }).
 *
 * Puntos de acción: atacar cuesta 1 PA. Si el aviso está activo y no hay suficientes,
 * se pregunta antes de nada; el PA se resta cuando la tirada llega a crearse (si se
 * cancela el diálogo de tirada no se cobra).
 *
 * @param {Item} item
 * @param {{beforeRoll?: () => Promise<void>|void}} [options]
 *        beforeRoll: se ejecuta tras aceptar el aviso y antes de abrir la tirada
 *        (p. ej. para fijar el objetivo).
 */
export async function rollWeaponAttack(item, { beforeRoll } = {}) {
  const actor = item.actor;
  const tracked = isTracked(actor);

  if (tracked && !(await confirmIfInsufficient([{ actor, cost: 1 }]))) return;

  await beforeRoll?.();

  if (tracked) expectSpend(actor, "weapon", 1);
  try {
    await item.system.roll();
  } catch (err) {
    // Típicamente: el actor no tiene la habilidad asociada al arma.
    console.error("zweihander-addons | Error al lanzar el arma", err);
    ui.notifications.error(
      game.i18n.format("ZWEI.othermessages.noskillexists", {
        skill: item.system?.associatedSkill ?? "?"
      })
    );
  } finally {
    if (tracked) clearExpected(actor, "weapon");
  }
}
