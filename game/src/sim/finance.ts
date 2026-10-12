// Where savings go, and the lottery.
//
// Investing: the WID wealth distribution already reflects what typical households earn on what they own.
// A player who holds something else gets the difference: each year a year of real returns is drawn,
// and the extra gain is (return of the chosen asset - return of the usual mix) x what they owned last
// year; extra gains from earlier years are invested the same way. A usual saver is unaffected.
//
// The years come from our own statistical model (data/out/returns_model.json): a multivariate Student t
// for the log real returns of shares, housing and bills, with means, covariances and fat tails fitted to
// the Jordà-Schularick-Taylor Macrohistory Database (16 advanced economies, 1950-2020). The yearly rows
// of that database are not shipped (CC BY-NC-SA 4.0); scripts can still draw real historical years from
// a local copy (setReturns) to check that the model gives the same results.
//
// ASSUMPTIONS:
// - The usual household mix is 60% housing, 25% deposits (bill rate), 15% shares, roughly the make-up
//   of household assets in the euro area (ECB HFCS) and the US (Fed SCF).
// - Every country draws from the history of the 16 advanced economies (no comparable long series for
//   others).
//
// Lottery: prize structure and odds of Vietlott Mega 6/45 (official: jackpot from 12 billion VND for a
// 10,000 VND ticket, 1 in 8,145,060; 10 million 1 in 34,808; 300,000 1 in 733; 30,000 1 in 45), one
// ticket a week. ASSUMPTION: a ticket costs 0.5% of the national median monthly income per person.

import type { Rng } from '../model/rng.ts';
import { gauss } from '../model/latent.ts';

export interface Returns { columns: string[]; rows: [number, string, number, number, number, number][] }
export interface ReturnsModel {
  assets: ['equity', 'housing', 'bills']; mean_log: number[]; cov_log: number[][]; df: number;
  stats: Record<'equity' | 'housing' | 'bills', { mean: number; worst: number; best: number }>;
}
let RETURNS: Returns | undefined; // historical rows: local checks only
let MODEL: (ReturnsModel & { chol: number[][] }) | undefined;
export const setReturns = (r: Returns | undefined) => { RETURNS = r; };
export function setReturnsModel(m: ReturnsModel): void {
  // Student t with covariance C has scale matrix C (df - 2) / df; Cholesky factor of that.
  const k = (m.df - 2) / m.df, S = m.cov_log.map(r => r.map(x => x * k)), n = S.length;
  const L = S.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = S[i][j];
    for (let q = 0; q < j; q++) s -= L[i][q] * L[j][q];
    L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
  }
  MODEL = { ...m, chol: L };
}

export type Portfolio = 'usual' | 'bank' | 'stocks' | 'housing';
/** ASSUMPTION: yearly spread of one property's return around the national index (individual houses
 *  are much riskier than the index; Giacoletti 2021, Review of Financial Studies). */
export const HOUSE_IDIO_SD = 0.1;
export const USUAL_MIX = { housing: 0.6, bills: 0.25, equity: 0.15 };

export interface YearReturns { equity: number; housing: number; bills: number; usual: number; year?: number; iso?: string }

const withUsual = (equity: number, housing: number, bills: number, year?: number, iso?: string): YearReturns =>
  ({ equity, housing, bills, year, iso, usual: USUAL_MIX.housing * housing + USUAL_MIX.bills * bills + USUAL_MIX.equity * equity });

/** One year of real returns: from the model, or a real historical year when local rows are loaded. */
export function drawYear(rng: Rng): YearReturns {
  if (RETURNS) {
    const r = RETURNS.rows[Math.floor(rng() * RETURNS.rows.length)];
    return withUsual(r[2], r[3], r[5], r[0], r[1]);
  }
  const m = MODEL!;
  const g = [gauss(rng), gauss(rng), gauss(rng)];
  let w = 0;
  for (let i = 0; i < m.df; i++) { const x = gauss(rng); w += x * x; } // chi-square with df degrees of freedom
  const s = Math.sqrt(m.df / w);
  const x = m.chol.map((row, i) => m.mean_log[i] + s * row.reduce((acc, v, j) => acc + v * g[j], 0));
  return withUsual(Math.exp(x[0]) - 1, Math.exp(x[1]) - 1, Math.exp(x[2]) - 1);
}

export const assetReturn = (y: YearReturns, p: Portfolio) => (p === 'bank' ? y.bills : p === 'stocks' ? y.equity : p === 'housing' ? y.housing : y.usual);

/** Long-run averages and the worst year on record, for the decision text. */
export function returnStats(): Record<'equity' | 'housing' | 'bills', { mean: number; worst: number }> {
  return MODEL!.stats;
}

// ---------------------------------------------------------------- lottery

export const TICKET_SHARE = 0.005; // of median monthly income per person
const PRIZES: [number, number][] = [[1_200_000, 1 / 8_145_060], [1000, 1 / 34_808], [30, 1 / 733], [3, 1 / 45]];

/** A year of weekly tickets: total won, in tickets, and the largest prize multiple. */
export function lotteryYear(rng: Rng): { won: number; best: number } {
  let won = 0, best = 0;
  for (let w = 0; w < 52; w++) {
    let u = rng();
    for (const [mult, p] of PRIZES) {
      if (u < p) { won += mult; best = Math.max(best, mult); break; }
      u -= p;
    }
  }
  return { won, best };
}

/** Expected payout per ticket (share of the price), for the decision text. */
export const LOTTERY_PAYOUT = PRIZES.reduce((s, [m, p]) => s + m * p, 0);
