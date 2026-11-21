export const MODULE_ID = "zweihander-addons";
export const TARGETS_FLAG = "targets";

/** IDs de los tokens que tiene marcados un TokenDocument (flag propio del token). */
export function getTargetIds(tokenDoc) {
  return tokenDoc?.getFlag(MODULE_ID, TARGETS_FLAG) ?? [];
}

/**
 * Cada vez que ESTE usuario marca o desmarca un target, se copia su lista de
 * targets al flag de los tokens que tiene seleccionados (o, si no tiene ninguno
 * seleccionado, a los tokens de su personaje). Así cada token guarda sus objetivos.
 */
export function registerTargetSync() {
  const sync = foundry.utils.debounce(syncTargets, 100);
  Hooks.on("targetToken", (user) => {
    if (user.id === game.user.id && !suppressSync) sync();
  });
}

let suppressSync = false;

/**
 * Pone un único objetivo (soltando los demás) y lo guarda en el flag del token
 * atacante, sin pasar por la sincronización por selección: así el objetivo se
 * asigna al token que ataca aunque no esté seleccionado.
 * @param {Token} targetToken        Placeable que pasa a ser el objetivo
 * @param {TokenDocument} [sourceDoc] Token atacante
 */
export async function setSingleTarget(targetToken, sourceDoc) {
  suppressSync = true;
  try {
    targetToken.setTarget(true, { releaseOthers: true, groupSelection: false });
  } finally {
    setTimeout(() => { suppressSync = false; }, 300);
  }
  if (sourceDoc?.isOwner) {
    const current = getTargetIds(sourceDoc);
    if (current.length !== 1 || current[0] !== targetToken.id) {
      await sourceDoc.setFlag(MODULE_ID, TARGETS_FLAG, [targetToken.id]);
    }
  }
}

async function syncTargets() {
  const user = game.user;
  const targetIds = Array.from(user.targets, (t) => t.id);

  let sources = canvas.tokens?.controlled ?? [];
  if (!sources.length && user.character) sources = user.character.getActiveTokens();

  await Promise.all(
    sources
      .filter((t) => t.document.isOwner)
      .map((t) => {
        const ids = targetIds.filter((id) => id !== t.id);
        const current = getTargetIds(t.document);
        const same = ids.length === current.length && ids.every((id) => current.includes(id));
        if (same) return null;
        return ids.length
          ? t.document.setFlag(MODULE_ID, TARGETS_FLAG, ids)
          : t.document.unsetFlag(MODULE_ID, TARGETS_FLAG);
      })
  );
}
