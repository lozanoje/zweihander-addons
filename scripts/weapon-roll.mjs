/**
 * Lanza la tirada de ataque de un arma exactamente como el botón de la ficha:
 * abre el diálogo "Configurar tirada" del sistema Zweihander.
 *
 * El sistema lo implementa en item.system.roll() (ZweihanderBaseItemModel), que
 * localiza la habilidad asociada al arma y llama a rollTest(..., { showDialog: true }).
 */
export async function rollWeaponAttack(item) {
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
  }
}
