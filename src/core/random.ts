/**
 * Small, fast, seedable PRNG (mulberry32). A seed makes "surprise me" reproducible
 * in tests; in the app we seed from `Date.now()`.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniformly pick one element, or undefined when the list is empty. */
export function pick<T>(items: readonly T[], rand: () => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rand() * items.length)];
}

/**
 * Pick one element with probability proportional to `weight`. Falls back to a
 * uniform pick when all weights are zero. "Random" with a thumb on the scale keeps
 * a serendipitous pick feeling meaningful rather than arbitrary.
 */
export function weightedPick<T>(
  items: readonly T[],
  weight: (item: T) => number,
  rand: () => number,
): T | undefined {
  if (items.length === 0) return undefined;
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return pick(items, rand);
  let r = rand() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r < 0) return it;
  }
  return items[items.length - 1];
}
