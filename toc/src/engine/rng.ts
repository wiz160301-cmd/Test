/**
 * Générateur pseudo-aléatoire déterministe et sérialisable.
 *
 * L'état du RNG fait partie du GameState : deux clients qui rejouent la même
 * suite d'actions à partir du même état obtiennent exactement la même partie.
 * C'est ce qui rendra le mode en ligne possible sans rejouer les mélanges
 * côté serveur.
 */

/** État du générateur : un simple entier 32 bits, donc sérialisable en JSON. */
export type RngState = number;

/** Résultat d'un tirage : la valeur et le nouvel état, jamais de mutation. */
export interface RngDraw {
  value: number;
  state: RngState;
}

/** mulberry32 — rapide, bonne distribution, état tenant sur 32 bits. */
export function nextRandom(state: RngState): RngDraw {
  let t = (state + 0x6d2b79f5) | 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, state: t };
}

/** Entier dans [0, max[ . */
export function nextInt(state: RngState, max: number): RngDraw {
  const draw = nextRandom(state);
  return { value: Math.floor(draw.value * max), state: draw.state };
}

/** Crée un état de RNG à partir d'une graine quelconque (nombre ou texte). */
export function seedFrom(seed: number | string): RngState {
  if (typeof seed === 'number') return seed | 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Mélange de Fisher-Yates. Retourne un nouveau tableau et le nouvel état. */
export function shuffle<T>(items: readonly T[], state: RngState): { items: T[]; state: RngState } {
  const result = items.slice();
  let current = state;
  for (let i = result.length - 1; i > 0; i--) {
    const draw = nextInt(current, i + 1);
    current = draw.state;
    const j = draw.value;
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return { items: result, state: current };
}
