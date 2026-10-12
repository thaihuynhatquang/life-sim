// Turning a national share into an individual yes/no that depends on who you are.
//
// Each trait gets a latent normal score correlated with something about the person (usually family
// wealth). The person "has" the trait if the score lands in the top `share` of the distribution.
// Because the latent score is still standard normal overall, the national share is preserved exactly,
// while richer (or poorer) people are more likely to have it.

import type { Rng } from './rng.ts';
import { invNorm, normalQuadrature } from './stats.ts';

export function gauss(rng: Rng): number {
  return invNorm(Math.min(1 - 1e-12, Math.max(1e-12, rng())));
}

/** Standard normal score with correlation `rho` to `z` (z itself standard normal). */
export function latent(rng: Rng, z: number, rho: number): number {
  return rho * z + Math.sqrt(1 - rho * rho) * gauss(rng);
}

/** True for the top `share` (0..1) of a standard normal latent. */
export function inTop(score: number, share: number): boolean {
  if (share <= 0) return false;
  if (share >= 1) return true;
  return score > invNorm(1 - share);
}

const QUAD = normalQuadrature(80);

/** Find shift s so that E[clamp(round(s + sd*Z), lo, hi)] = target. Rounding and clamping at 0 or at
 *  the maximum would otherwise bias the mean of things like years of schooling. */
export function calibrateClamped(target: number, sd: number, lo: number, hi: number): number {
  const mean = (s: number) => QUAD.z.reduce((acc, z, i) =>
    acc + QUAD.w[i] * Math.min(hi, Math.max(lo, Math.round(s + sd * z))), 0);
  let a = lo - 3 * sd, b = hi + 3 * sd;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (mean(m) < target) a = m; else b = m;
  }
  return (a + b) / 2;
}

/** P(clamp(round(s + sd*Z)) >= k). */
export function probAtLeast(s: number, sd: number, k: number): number {
  return QUAD.z.reduce((acc, z, i) => acc + (Math.round(s + sd * z) >= k ? QUAD.w[i] : 0), 0);
}
