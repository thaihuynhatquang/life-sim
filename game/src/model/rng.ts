// Seeded PRNG so a life can be replayed from its seed.

export type Rng = () => number; // uniform [0, 1)

/** sfc32: small, fast, good statistical quality. */
export function makeRng(seed: number): Rng {
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = seed >>> 0;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next(); // warm up
  return next;
}

/** Pick an index with probability proportional to weights, via a precomputed cumulative table. */
export function makeWeightedPicker(weights: number[]): (rng: Rng) => number {
  const cum = new Float64Array(weights.length);
  let s = 0;
  weights.forEach((w, i) => { s += w; cum[i] = s; });
  return rng => {
    const x = rng() * s;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] > x) hi = mid; else lo = mid + 1;
    }
    return lo;
  };
}
