import { findCombatant } from "./action-points.mjs";

/** Resultado de una pifia (ZweihanderDice.OUTCOME_TYPES). */
const CRITICAL_FAILURE = 0;

/**
 * Una pifia en una acción de ataque causa fatiga de combate: se reciben 2d10+2 puntos de
 * estrés físico, como si el atacante fallase una tirada de Locura por Miedo. Se crea la misma
 * tarjeta "Aplicar estrés" que el sistema genera al fallar esa tirada (rollPerilDamage).
 */
export function registerStressOnFumble() {
  Hooks.on("createChatMessage", async (message, options, userId) => {
    if (userId !== game.user.id) return;
    const data = message.flags?.zweihander?.skillTestData;
    if (data?.testType !== "weapon" || data.outcome !== CRITICAL_FAILURE) return;

    // Solo para combatientes del combate activo ya iniciado.
    const actor = fromUuidSync(data.actorUuid);
    if (!actor || !findCombatant(actor)) return;

    try {
      await createFearStressCard(actor);
    } catch (err) {
      console.error("zweihander-addons | No se pudo crear la tarjeta de estrés de la pifia", err);
      ui.notifications.error(`zweihander-addons: ${game.i18n.localize("ZWH_ADDONS.Stress.Failed")} (${err.message})`);
    }
  });

  registerStressApply();
}

/**
 * Réplica de ZweihanderDice.rollPerilDamage con madnessType "fear" (el sistema no la expone):
 * tirada 2d10 + 2, datos del objetivo (el propio actor) y tarjeta chat-madness.hbs.
 */
export async function createFearStressCard(actor) {
  const madnessType = "fear";
  const madnessLevel = 2;
  const roll = await new Roll(`${madnessLevel}d10 + ${madnessLevel}`).evaluate();

  const target = stressTargetData(actor, roll.total, madnessLevel);
  const render = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  const content = await render(CONFIG.ZWEI.templates.madness, {
    tooltip: await roll.getTooltip(),
    total: roll.total,
    formula: roll.formula,
    madnessType
  });

  return roll.toMessage(
    { speaker: ChatMessage.getSpeaker({ actor }), content, flags: { zweihander: { madnessTestData: { target } } } },
    { rollMode: CONST.DICE_ROLL_MODES.PUBLIC }
  );
}

/**
 * Niveles de estrés que baja un total frente al umbral: hay que SUPERARLO. Con umbral 5, un total
 * de 5 no baja ningún nivel y un 6 baja uno; cada 6 puntos más, otro nivel (como el marcador).
 * Un 4º nivel significa incapacitado al instante (umbral + 19 o más).
 */
export function stressSteps(total, threshold) {
  return Math.min(4, Math.max(0, Math.floor((total - threshold - 1) / 6) + 1));
}

/**
 * Datos del objetivo de la tarjeta. Como _preCalculateTargetData(actor, total, "peril") del
 * sistema, pero superando el umbral (ver stressSteps) y sin tocar la corrupción de actores que no
 * la tienen (PNJ y criaturas).
 */
export function stressTargetData(actor, total, madnessLevel) {
  const { perilThreshold, perilCurrent } = actor.system.stats.secondaryAttributes;
  const target = { uuid: actor.uuid, name: actor.name, damaged: false, finalThresholdStep: -1 };

  const stepsToFall = stressSteps(total, perilThreshold.value);
  if (stepsToFall > 0) {
    // Incapacitado al instante si supera el umbral de peligro + 18.
    const finalSteps = stepsToFall < 4 ? stepsToFall : 5;
    target.finalThresholdStep = Math.max(0, perilCurrent.value - finalSteps);
  }

  // La corrupción solo existe en los personajes (en los PNJ "alignment" es un texto).
  const corruption = actor.system.alignment?.corruption;
  if (typeof corruption === "number") target.finalCorruptionStep = corruption + madnessLevel;
  return target;
}

/**
 * "Aplicar estrés" del sistema actualiza también system.alignment.corruption, que en PNJ y
 * criaturas no es un número (y podría estropear su alineamiento). Para ellos el botón de la tarjeta
 * solo aplica el estrés.
 */
function registerStressApply() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const target = message.flags?.zweihander?.madnessTestData?.target;
    if (!target) return;
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root || root.dataset.zwhStress) return;
    root.dataset.zwhStress = "1";

    root.addEventListener(
      "click",
      (ev) => {
        const btn = ev.target.closest?.(".skill-test-peril");
        if (!btn || btn.disabled) return;
        const actor = fromUuidSync(target.uuid);
        if (!actor || actor.type === "character") return; // los personajes siguen el flujo del sistema
        ev.preventDefault();
        ev.stopImmediatePropagation();
        applyStressWithoutCorruption(message);
      },
      true
    );
  });
}

export async function applyStressWithoutCorruption(message) {
  const target = message.flags?.zweihander?.madnessTestData?.target;
  const actor = target ? fromUuidSync(target.uuid) : null;
  if (!actor?.isOwner || target.damaged) return;

  if (target.finalThresholdStep !== -1) {
    await actor.update({ "system.stats.secondaryAttributes.perilCurrent.value": target.finalThresholdStep });
  }
  await message.update({ "flags.zweihander.madnessTestData.target": { ...target, damaged: true } });
}
