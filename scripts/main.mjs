import { MODULE_ID, registerTargetSync } from "./targets.mjs";
import { onRenderCombatTracker } from "./combat-tracker.mjs";
import { registerChatTarget } from "./chat-target.mjs";
import { registerCanvasDrop } from "./drag-drop.mjs";
import { registerSpendOnRoll } from "./action-points.mjs";
import { registerReactionCost } from "./ap-reactions.mjs";
import { registerMovementCost } from "./ap-movement.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "nameMaxLength", {
    name: "ZWH_ADDONS.Settings.NameMaxLength.Name",
    hint: "ZWH_ADDONS.Settings.NameMaxLength.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: 12,
    range: { min: 4, max: 30, step: 1 },
    onChange: () => refreshTracker()
  });

  game.settings.register(MODULE_ID, "canvasFollowsSelection", {
    name: "ZWH_ADDONS.Settings.CanvasFollowsSelection.Name",
    hint: "ZWH_ADDONS.Settings.CanvasFollowsSelection.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "apWarning", {
    name: "ZWH_ADDONS.Settings.ApWarning.Name",
    hint: "ZWH_ADDONS.Settings.ApWarning.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "weaponsOwnersOnly", {
    name: "ZWH_ADDONS.Settings.WeaponsOwnersOnly.Name",
    hint: "ZWH_ADDONS.Settings.WeaponsOwnersOnly.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: () => refreshTracker()
  });
});

Hooks.once("ready", () => {
  registerTargetSync();
  registerChatTarget();
  registerCanvasDrop();
  registerSpendOnRoll();
  registerReactionCost();
  registerMovementCost();
});

Hooks.on("renderCombatTracker", onRenderCombatTracker);

/** Re-render agrupado del tracker. */
const refreshTracker = foundry.utils.debounce(() => {
  if (ui.combat?.rendered) ui.combat.render({ parts: ["tracker"] });
}, 100);

// Cambian los objetivos guardados en un token, o su posición/tamaño.
Hooks.on("updateToken", (doc, changes) => {
  const moved = ["x", "y", "width", "height"].some((k) => k in changes);
  const retargeted = changes.flags?.[MODULE_ID] !== undefined;
  // Actores sin vincular: sus estadísticas cambian a través del delta del token.
  const statsChanged = foundry.utils.hasProperty(changes, "delta.system.stats");
  if (moved || retargeted || statsChanged) refreshTracker();
});

// Puntos de acción, daño y estrés.
Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.hasProperty(changes, "system.stats")) refreshTracker();
});
Hooks.on("deleteToken", refreshTracker);
Hooks.on("canvasReady", refreshTracker);

// Cambios en el equipo.
Hooks.on("updateItem", (item, changes) => {
  if (foundry.utils.hasProperty(changes, "system.equipped")) refreshTracker();
});
Hooks.on("createItem", refreshTracker);
Hooks.on("deleteItem", refreshTracker);
