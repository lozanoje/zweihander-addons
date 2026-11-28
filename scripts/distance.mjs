import { MODULE_ID } from "./targets.mjs";

/**
 * Sistema de distancias: trabado (engaged), alcances y restricciones por tipo de arma.
 *
 * - La distancia entre dos tokens es el número de casillas libres entre ellos (adyacentes = 0 = trabados).
 *   Cada casilla vale `scene.grid.distance` metros (1 por defecto).
 * - Tipos de arma: cuerpo a cuerpo = las que se usan trabado (o a 1 metro); a distancia = las que tienen
 *   alcance (system.ranged.value); arrojadiza = a distancia con la cualidad Arrojadiza.
 * - Cuerpo a cuerpo: hay que estar trabado (0), o a 1 metro como máximo con la cualidad Alcance (1 metro,
 *   no 1 casilla: con 5 m por casilla, a una casilla ya no se llega).
 * - Arrojadiza: solo alcance corto. Si el objetivo está trabado y el arma se puede usar cuerpo a cuerpo,
 *   se ataca cuerpo a cuerpo.
 * - A distancia: corto (hasta F), medio (2F, -10%), largo (3F, -20%), extremo (4F, -30% y sin dado de
 *   Furia); más allá no se puede. F = bono del atributo de la fórmula del arma (p. ej. [PB]) + bono de distancia.
 * - Estar trabado con cualquiera (el objetivo u otro) impide usar armas arrojadizas y a distancia (salvo
 *   Pólvora, que además no se puede parar ni esquivar).
 * - Pólvora: se puede disparar trabado y el ataque no se puede parar ni esquivar.
 */

/* ---------------------------------------------------------------- */
/*  Cualidades                                                       */
/* ---------------------------------------------------------------- */

const normalize = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** Nombres de la cualidad en los idiomas conocidos (ya normalizados: minúsculas y sin tildes). */
const TRAIT_NAMES = {
  reach: ["reach", "alcance"],
  throwing: ["throwing", "arrojadiza", "arrojadizas", "arrojadizo", "arrojadizos"],
  gunpowder: ["gunpowder", "polvora"]
};

/** Ids de las cualidades de los compendios del sistema (valen aunque el nombre esté traducido). */
const TRAIT_IDS = {
  reach: ["HZVu7VfwJDkoCO1U", "BaUibtYPW3195USx"],
  throwing: ["7MgNQOn5EC5tCAum", "YCtHVDVhh8ub7gOm"],
  gunpowder: ["0L1YXMkZ0dXhGb0R"]
};

const traitCache = new Map();

/** Cualidades especiales (de las que nos interesan) que representa el UUID de una cualidad. */
async function qualityTraits(uuid) {
  if (traitCache.has(uuid)) return traitCache.get(uuid);

  const id = uuid.split(".").pop();
  const found = Object.keys(TRAIT_IDS).filter((t) => TRAIT_IDS[t].includes(id));
  if (!found.length) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) return []; // sin caché: puede que el compendio aún no esté disponible
    const name = normalize(doc.name);
    for (const trait of Object.keys(TRAIT_NAMES)) if (TRAIT_NAMES[trait].includes(name)) found.push(trait);
  }
  traitCache.set(uuid, found);
  return found;
}

/** @returns {Promise<{reach: boolean, throwing: boolean, gunpowder: boolean}>} */
export async function weaponTraits(weapon) {
  const traits = new Set();
  for (const uuid of weapon?.system?.qualities ?? []) {
    if (!uuid) continue;
    for (const trait of await qualityTraits(uuid)) traits.add(trait);
  }
  return { reach: traits.has("reach"), throwing: traits.has("throwing"), gunpowder: traits.has("gunpowder") };
}

/* ---------------------------------------------------------------- */
/*  Tipo de arma y alcance corto                                     */
/* ---------------------------------------------------------------- */

const MELEE_TEXT = /melee|cuerpo|nahkampf|m[eê]l[eé]e|corps/;
const RANGED_TEXT = /ranged|distancia|fernkampf|distance/;

/**
 * ¿Se puede usar el arma cuerpo a cuerpo? Lo indica su habilidad asociada (Cuerpo a cuerpo simple/marcial)
 * o su tipo («Melee or Ranged»). Sirve para armas arrojadizas que también se usan trabado (cuchillo, lanza…).
 */
export function meleeCapable(weapon) {
  const skill = normalize(weapon?.system?.associatedSkill);
  if (RANGED_TEXT.test(skill)) return false;
  return MELEE_TEXT.test(skill) || MELEE_TEXT.test(normalize(weapon?.system?.weaponType));
}

const ATTRIBUTE_OF_BONUS = {
  CB: "combat", BB: "brawn", AB: "agility", PB: "perception", IB: "intelligence", WB: "willpower", FB: "fellowship"
};

/** Alcance corto en metros: bono del atributo de la fórmula del arma (p. ej. [PB]) + bono de distancia. */
export function shortRange(weapon) {
  const distance = weapon?.system?.distance;
  const code = /\[(CB|BB|AB|PB|IB|WB|FB)\]/.exec(distance?.base ?? "")?.[1];
  const attribute = code ? weapon.actor?.system?.stats?.primaryAttributes?.[ATTRIBUTE_OF_BONUS[code]]?.bonus : 0;
  return (Number(attribute) || 0) + (Number(distance?.bonus) || 0);
}

/**
 * Dados de Furia de la fórmula de daño del arma (los que no se tiran a distancia extrema). Se resta
 * esa cantidad en «Dado de Furia adicional» para que la tirada de daño no lleve ninguno.
 */
export function furyDiceCount(weapon) {
  const damage = weapon?.system?.damage;
  if (damage?.formula?.override) {
    const match = /\((\d+)\s*\+\s*\[#\]\)\s*d/.exec(damage.formula.value ?? "");
    if (match) return Number(match[1]);
  }
  return Number(damage?.number) || 1;
}

/* ---------------------------------------------------------------- */
/*  Reglas (función pura, sin Foundry)                               */
/* ---------------------------------------------------------------- */

/** Dificultad (modificador en %) de cada tramo de alcance: un nivel de dificultad son 10 puntos. */
export const RANGE_DIFFICULTY = { short: 0, medium: -10, long: -20, extreme: -30 };

/** Alcance de la cualidad Alcance, en metros (no en casillas). */
export const REACH_METERS = 1;

/**
 * Decide si se puede atacar y con qué modificadores.
 *
 * @param {object} input
 * @param {{reach: boolean, throwing: boolean, gunpowder: boolean}} input.traits
 * @param {boolean} input.rangedFlag system.ranged.value: el arma tiene alcance (a distancia)
 * @param {boolean} input.meleeCapable El arma se puede usar cuerpo a cuerpo (ver meleeCapable)
 * @param {number} input.spaces Casillas libres entre atacante y objetivo (0 = trabados)
 * @param {number} input.unit Metros por casilla
 * @param {number} input.short Alcance corto en metros
 * @param {string|null} [input.engagedWith] Nombre de otro actor con el que el atacante está trabado (distinto del objetivo)
 * @returns {{ok: boolean, mode: string, reason?: string, data?: object, info?: object}}
 *   reason: clave de ZWH_ADDONS.Distance.*; info: modificadores del ataque.
 */
export function evaluateAttack({ traits, rangedFlag, meleeCapable: canMelee, spaces, unit, short, engagedWith = null }) {
  const meters = spaces * unit;
  const engagedTarget = spaces === 0;
  const engaged = engagedTarget || !!engagedWith;

  // Tipo de arma: sin alcance = cuerpo a cuerpo; con alcance = a distancia, o arrojadiza si tiene la cualidad.
  // Una arrojadiza que también se usa cuerpo a cuerpo, con el objetivo trabado, ataca cuerpo a cuerpo.
  let mode;
  if (!rangedFlag) mode = "melee";
  else if (traits.throwing) mode = engagedTarget && canMelee ? "melee" : "thrown";
  else mode = canMelee ? "melee" : "ranged"; // marcada con alcance pero de habilidad cuerpo a cuerpo (p. ej. Spontoon)

  const info = { mode, band: "short", difficulty: 0, gunpowder: traits.gunpowder, noFury: false };
  const fail = (reason, data = {}) => ({ ok: false, mode, reason, data: { distance: meters, short, ...data } });

  if (mode === "melee") {
    if (engagedTarget) return { ok: true, mode, info };
    if (traits.reach && meters <= REACH_METERS) return { ok: true, mode, info };
    return fail(traits.reach ? "ReachTooFar" : "NotEngaged");
  }

  if (mode === "thrown") {
    if (engaged) return fail("EngagedThrown", { enemy: engagedWith });
    if (meters > short) return fail("ThrownTooFar");
    return { ok: true, mode, info }; // siempre alcance corto, sin modificadores
  }

  // A distancia
  if (engaged && !traits.gunpowder) return fail("EngagedRanged", { enemy: engagedWith });
  if (meters <= short) info.band = "short";
  else if (meters <= short * 2) info.band = "medium";
  else if (meters <= short * 3) info.band = "long";
  else if (meters <= short * 4) info.band = "extreme";
  else return fail("TooFar", { max: short * 4 });

  info.difficulty = RANGE_DIFFICULTY[info.band];
  info.noFury = info.band === "extreme";
  return { ok: true, mode, info };
}

/* ---------------------------------------------------------------- */
/*  Geometría del lienzo                                             */
/* ---------------------------------------------------------------- */

/** Casillas libres entre dos tokens (placeables): adyacentes = 0. Las diagonales cuentan como 1. */
export function spacesBetween(a, b) {
  const grid = canvas.grid;
  if (grid.isHexagonal) {
    const path = grid.measurePath([a.center, b.center]);
    const centers = path.spaces ?? path.distance / (canvas.scene.grid.distance || 1);
    return Math.max(0, Math.round(centers - (a.document.width + b.document.width) / 2));
  }

  const sizeX = grid.sizeX ?? grid.size;
  const sizeY = grid.sizeY ?? grid.size;
  const box = (t) => ({
    x0: t.document.x, x1: t.document.x + t.document.width * sizeX,
    y0: t.document.y, y1: t.document.y + t.document.height * sizeY
  });
  const A = box(a);
  const B = box(b);
  const gapX = Math.max(0, B.x0 - A.x1, A.x0 - B.x1) / sizeX;
  const gapY = Math.max(0, B.y0 - A.y1, A.y0 - B.y1) / sizeY;
  return Math.max(0, Math.round(Math.max(gapX, gapY)));
}

/** Nombre de otro actor adyacente al atacante con el que está trabado (distinto del objetivo), o null. */
function adjacentEngaged(attacker, target) {
  for (const token of canvas.tokens.placeables) {
    if (token.id === attacker.id || token.id === target.id) continue;
    // Los del mismo bando (misma disposición) no traban: si no, un arquero rodeado de aliados nunca podría disparar.
    if (token.document.hidden || token.document.disposition === attacker.document.disposition) continue;
    if (token.combatant?.isDefeated || token.actor?.statuses?.has("dead")) continue;
    if (spacesBetween(attacker, token) === 0) return token.name;
  }
  return null;
}

/* ---------------------------------------------------------------- */
/*  Comprobación de un ataque con arma                               */
/* ---------------------------------------------------------------- */

const TRIVIAL = { ok: true, info: null };

/**
 * Comprueba las reglas de distancia de un ataque contra el primer objetivo del usuario. Si no se
 * puede atacar avisa con un mensaje. Sin objetivo, sin token del atacante o con la opción
 * desactivada no se comprueba nada.
 *
 * @param {Item} weapon
 * @param {Token} [attackerToken]
 * @returns {Promise<{ok: boolean, info: object|null}>} info: { band, difficulty, noFury, gunpowder, furyAdjust }
 */
export async function checkAttackDistance(weapon, attackerToken) {
  if (!game.settings.get(MODULE_ID, "distanceRules") || !canvas.ready) return TRIVIAL;

  if (!attackerToken) {
    const tokens = weapon.actor?.getActiveTokens?.(true) ?? [];
    if (tokens.length === 1) attackerToken = tokens[0];
  }
  const target = [...game.user.targets][0];
  if (!attackerToken || !target || target.id === attackerToken.id) return TRIVIAL;
  if (attackerToken.document.parent?.id !== canvas.scene?.id) return TRIVIAL;

  const traits = await weaponTraits(weapon);
  const unit = canvas.scene.grid.distance || 1;
  const spaces = spacesBetween(attackerToken, target);

  const result = evaluateAttack({
    traits, rangedFlag: !!weapon.system?.ranged?.value, meleeCapable: meleeCapable(weapon), spaces, unit,
    short: shortRange(weapon),
    // Solo hace falta buscar con quién más está trabado si el arma no se puede usar trabado.
    engagedWith: spaces > 0 && !traits.gunpowder ? adjacentEngaged(attackerToken, target) : null
  });

  const fmt = (key, data) => game.i18n.format(`ZWH_ADDONS.Distance.${key}`, data);
  const base = { weapon: weapon.name, target: target.name, ...(result.data ?? {}) };
  const round = (n) => Math.round(n * 100) / 100;

  if (!result.ok) {
    const enemy = base.enemy ? fmt("EnemyAdjacent", { name: base.enemy }) : "";
    ui.notifications.warn(
      fmt(result.reason, { ...base, distance: round(base.distance), short: round(base.short), max: round(base.max ?? 0), enemy }).trim()
    );
    return { ok: false, info: null };
  }

  const { band, difficulty, noFury, gunpowder } = result.info;
  if (band !== "short") {
    ui.notifications.info(fmt(`Band.${band}`, { distance: round(spaces * unit), difficulty }));
  }
  return {
    ok: true,
    info: { band, difficulty, noFury, gunpowder, furyAdjust: noFury ? -furyDiceCount(weapon) : 0 }
  };
}
