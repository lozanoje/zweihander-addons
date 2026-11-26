import { isTracked } from "./action-points.mjs";

/** Resultado de una pifia (ZweihanderDice.OUTCOME_TYPES). */
const CRITICAL_FAILURE = 0;

/**
 * Una pifia en una acción de ataque causa fatiga de combate: se reciben 2d10+2 puntos de
 * estrés físico, como si el atacante fallase una tirada de Locura por Miedo. Se crea la misma
 * tarjeta "Aplicar estrés" que el sistema genera al fallar esa tirada (rollPerilDamage).
 */
export function registerStressOnFumble() {
  Hooks.on("createChatMessage", (message, options, userId) => {
    if (userId !== game.user.id) return;
    const data = message.flags?.zweihander?.skillTestData;
    if (data?.testType !== "weapon" || data.outcome !== CRITICAL_FAILURE) return;

    const actor = fromUuidSync(data.actorUuid);
    if (actor && isTracked(actor)) createFearStressCard(actor);
  });
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

/** Mismo cálculo que _preCalculateTargetData(actor, total, "peril") del sistema. */
export function stressTargetData(actor, total, madnessLevel) {
  const { perilThreshold, perilCurrent } = actor.system.stats.secondaryAttributes;
  const target = { uuid: actor.uuid, name: actor.name, damaged: false, finalThresholdStep: -1 };

  const stepsToFall = Math.min(4, Math.max(0, Math.floor((total - perilThreshold.value) / 6) + 1));
  if (stepsToFall > 0) {
    // Incapacitado al instante si supera el umbral de peligro + 18.
    const finalSteps = stepsToFall < 4 ? stepsToFall : 5;
    target.finalThresholdStep = Math.max(0, perilCurrent.value - finalSteps);
  }
  target.finalCorruptionStep = actor.system.alignment.corruption + madnessLevel;
  return target;
}
