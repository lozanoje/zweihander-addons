import { MODULE_ID, tokenImage } from "./targets.mjs";

export const ATTACK_TARGETS_FLAG = "attackTargets";

/**
 * Objetivo del ataque en los mensajes de chat del arma (tirada de ataque y daño).
 * - Al crear el mensaje (solo en el cliente que tira) se guardan los targets del usuario.
 *   El sistema guarda en la tarjeta de daño el UUID del actor, no del token, y con
 *   actores vinculados no permite volver al token; por eso se guardan aquí los tokens.
 * - Al pintarlo, se añade el token a la derecha de la cabecera (nombre del arma).
 */
export function registerChatTarget() {
  Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
    if (userId !== game.user.id) return;
    const flags = message.flags?.zweihander;
    const isAttack = ["weapon", "spell"].includes(flags?.skillTestData?.testType);
    const isDamage = !!flags?.weaponTestData;
    if (!isAttack && !isDamage) return;

    const targets = Array.from(game.user.targets, (t) => ({
      uuid: t.document.uuid,
      name: t.document.name,
      img: tokenImage(t.document)
    }));
    if (!targets.length) return;
    message.updateSource({ [`flags.${MODULE_ID}.${ATTACK_TARGETS_FLAG}`]: targets });
  });

  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
}

function onRenderChatMessage(message, html) {
  const targets = message.getFlag(MODULE_ID, ATTACK_TARGETS_FLAG);
  if (!targets?.length) return;

  const root = html instanceof HTMLElement ? html : html[0];
  // Tarjeta de ataque (.skill-test) o de daño (.weapon-content).
  const header = root?.querySelector(
    ".skill-test .title-and-subtitle, .weapon-content .title-and-subtitle"
  );
  if (!header || header.querySelector(".zwh-chat-target")) return;

  const [first, ...rest] = targets;

  const box = document.createElement("div");
  box.className = "zwh-chat-target";
  box.dataset.tooltip = `${game.i18n.localize("ZWH_ADDONS.AttackTarget")}: ${targets.map((t) => t.name).join(", ")}`;

  const img = document.createElement("img");
  img.src = first.img;
  img.alt = first.name;
  box.append(img);

  // Más de un objetivo: se muestra el primero con un contador.
  if (rest.length) {
    const badge = document.createElement("span");
    badge.className = "zwh-chat-target-more";
    badge.textContent = `+${rest.length}`;
    box.append(badge);
  }

  box.addEventListener("click", () => {
    const token = fromUuidSync(first.uuid)?.object;
    if (token) canvas.animatePan({ x: token.center.x, y: token.center.y });
  });

  header.classList.add("zwh-has-target");
  header.append(box);
}
