export const MODULE_ID = "zweihander-addons";
export const TARGETS_FLAG = "targets";

/** Imagen de un TokenDocument; evita usar vídeos (webm/mp4) como <img>. */
export function tokenImage(doc) {
  const src = doc.texture?.src ?? "";
  return /\.(webm|mp4|m4v)$/i.test(src) ? (doc.actor?.img ?? "icons/svg/mystery-man.svg") : src;
}

/** IDs de los tokens que tiene marcados un TokenDocument (flag propio del token). */
export function getTargetIds(tokenDoc) {
  return tokenDoc?.getFlag(MODULE_ID, TARGETS_FLAG) ?? [];
}

/**
 * Cada vez que ESTE usuario marca o desmarca un target, se copia su lista de
 * targets al flag de los tokens que tiene seleccionados (o, si no tiene ninguno
 * seleccionado, a los tokens de su personaje). Así cada token guarda sus objetivos.
 *
 * En sentido inverso, al seleccionar UN token los targets del lienzo pasan a ser
 * los que ese token tiene guardados, para que lienzo y asistente de combate
 * nunca muestren objetivos distintos.
 */
export function registerTargetSync() {
  const sync = foundry.utils.debounce(syncTargets, 100);
  Hooks.on("targetToken", (user) => {
    if (user.id === game.user.id && !suppressSync) sync();
  });

  const load = foundry.utils.debounce(loadTargetsFromSelection, 50);
  Hooks.on("controlToken", () => {
    if (game.settings.get(MODULE_ID, "canvasFollowsSelection")) load();
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

/** Ejecuta fn sin que los cambios de target que provoca se copien a los flags. */
function withoutSync(fn) {
  suppressSync = true;
  try {
    fn();
  } finally {
    setTimeout(() => { suppressSync = false; }, 300);
  }
}

/** Sustituye los targets del usuario por los tokens indicados. */
function applyTargets(ids) {
  const user = game.user;
  if (typeof user.updateTokenTargets === "function") {
    user.updateTokenTargets(ids);
  } else {
    for (const t of Array.from(user.targets)) {
      if (!ids.includes(t.id)) t.setTarget(false, { releaseOthers: false, groupSelection: true });
    }
    for (const id of ids) {
      const t = canvas.tokens.get(id);
      if (t && !t.isTargeted) t.setTarget(true, { releaseOthers: false, groupSelection: true });
    }
  }
  user.broadcastActivity?.({ targets: ids });
}

/**
 * Con exactamente un token seleccionado, el lienzo muestra los objetivos que ese
 * token tiene guardados (ninguno si no tiene). Con 0 o varios seleccionados no se toca nada.
 */
function loadTargetsFromSelection() {
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length !== 1) return;

  const wanted = getTargetIds(controlled[0].document).filter((id) => canvas.tokens.get(id));
  const current = Array.from(game.user.targets, (t) => t.id);
  const same = wanted.length === current.length && wanted.every((id) => current.includes(id));
  if (same) return;

  withoutSync(() => applyTargets(wanted));
}
