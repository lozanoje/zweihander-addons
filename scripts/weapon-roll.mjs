import { clearExpected, confirmIfInsufficient, expectSpend, isTracked } from "./action-points.mjs";
import { attackCost, clearPendingAttack, setPendingAttack } from "./attack-modifiers.mjs";
import { checkAttackDistance } from "./distance.mjs";

/**
 * Lanza la tirada de ataque de un arma exactamente como el botón de la ficha:
 * abre el diálogo "Configurar tirada" del sistema Zweihander.
 *
 * El sistema lo implementa en item.system.roll() (ZweihanderBaseItemModel), que
 * localiza la habilidad asociada al arma y llama a rollTest(..., { showDialog: true }).
 *
 * Puntos de acción: atacar cuesta 1 PA; un ataque localizado, 2; apuntar suma 1 o 2 más
 * (hasta 3 PA en total). Si el aviso está activo y no hay suficientes, se pregunta antes de
 * nada; los PA se restan cuando la tirada llega a crearse (si se cancela el diálogo de tirada
 * no se cobra).
 *
 * @param {Item} item
 * @param {object} [options]
 * @param {() => Promise<void>|void} [options.beforeRoll] Se ejecuta tras aceptar el aviso y antes
 *        de abrir la tirada (p. ej. para fijar el objetivo).
 * @param {boolean} [options.localized] Ataque localizado (2 PA, sin parada ni esquiva).
 * @param {number} [options.aim] Apuntar: 0, 1 (+10) o 2 (+20); suma esos PA.
 * @param {Token} [options.attackerToken] Token del atacante (para medir la distancia al objetivo).
 *
 * Distancias: tras fijar el objetivo se comprueban las reglas del tipo de arma (cuerpo a cuerpo,
 * arrojadiza, a distancia y sus cualidades). Si no se puede atacar se avisa y no se cobra nada.
 */
export async function rollWeaponAttack(item, { beforeRoll, localized = false, aim = 0, attackerToken } = {}) {
  const actor = item.actor;
  const tracked = isTracked(actor);
  const cost = attackCost({ localized, aim });

  // El objetivo se fija antes de comprobar la distancia (y antes del aviso de PA, para no avisar de PA
  // por un ataque que las reglas no permiten).
  await beforeRoll?.();

  const range = await checkAttackDistance(item, attackerToken);
  if (!range.ok) return;

  if (tracked && !(await confirmIfInsufficient([{ actor, cost }]))) return;

  if (tracked) expectSpend(actor, "weapon", cost);
  setPendingAttack(actor.uuid, { localized, aim, range: range.info });
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
    clearPendingAttack();
    if (tracked) clearExpected(actor, "weapon");
  }
}
