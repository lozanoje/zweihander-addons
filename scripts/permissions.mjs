/**
 * Estos datos (PA, daño, estrés, umbral de daño) solo se muestran a quien al menos
 * observa al actor (el GM siempre), para no revelar a los jugadores el estado de los PNJ.
 */
export const canSeeStatus = (actor) => !!actor && actor.testUserPermission(game.user, "OBSERVER");
