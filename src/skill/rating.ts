import {
  ACPL_ELO_CURVE,
  ACPL_TAPER_FULL_ELO,
  ACPL_TAPER_ZERO_ELO,
  BLEND_ACPL,
  BLUNDER_ELO_PER_RATE,
  CP_LOSS_CAP,
  HINT_GAIN_MAX_PENALTY,
  HINT_GAIN_STEP,
  GAIN_MIN,
  RESULT_TARGET_MAX,
  MATE_CLAMP_CP,
  MAX_RATING_STEP,
  RATING_MAX,
  RATING_MIN,
  RD_GAME_DECAY,
  RD_IDLE_DAYS,
  RD_IDLE_GROWTH,
  RD_MAX,
  RD_MIN,
  SHORT_LOSS_MULT,
  SHORT_LOSS_PLIES,
  START_RATING,
  BOT_OFFSET,
  START_RD,
} from './constants'
import type { GameSummary, PlayerState, RecentGame, UpdateResult } from './types'

export const RECENT_CAP = 20
const DAY_MS = 86_400_000

export function initialPlayerState(): PlayerState {
  return {
    rating: START_RATING,
    rd: START_RD,
    games: 0,
    lastGameAt: null,
    recent: [],
    botElo: START_RATING + BOT_OFFSET,
  }
}

const clampCp = (x: number): number => Math.max(-MATE_CLAMP_CP, Math.min(MATE_CLAMP_CP, x))

/** Centipawn loss of the played move. Mate scores are clamped before subtraction. Capped at CP_LOSS_CAP. */
export function cpLoss(bestScore: number, playedScore: number): number {
  const loss = clampCp(bestScore) - clampCp(playedScore)
  return Math.min(CP_LOSS_CAP, Math.max(0, loss))
}

/** ACPL to Elo: monotone piecewise linear over ACPL_ELO_CURVE, flat beyond its ends. */
export function acplToElo(acpl: number): number {
  const c = ACPL_ELO_CURVE
  if (acpl <= c[0]![0]) return c[0]![1]
  for (let i = 0; i < c.length - 1; i++) {
    const [a0, e0] = c[i]!
    const [a1, e1] = c[i + 1]!
    if (acpl <= a1) return e0 + ((e1 - e0) * (acpl - a0)) / (a1 - a0)
  }
  return c[c.length - 1]![1]
}

/**
 * ACPL weight at a given rating: BLEND_ACPL up to ACPL_TAPER_FULL_ELO, linear to 0 at ACPL_TAPER_ZERO_ELO.
 * Measured ACPL is flat above about skill 60 (docs/acpl.txt), so it carries little rating information there.
 */
export function acplWeight(rating: number): number {
  const t = (ACPL_TAPER_ZERO_ELO - rating) / (ACPL_TAPER_ZERO_ELO - ACPL_TAPER_FULL_ELO)
  return BLEND_ACPL * Math.max(0, Math.min(1, t))
}

/** Learning gain for the next game: 1 / (games + 1), never below GAIN_MIN. */
export function kFactor(games: number): number {
  return Math.max(GAIN_MIN, 1 / (games + 1))
}

/** Expected player score against a bot of the given Elo. */
export function expectedScore(rating: number, botElo: number): number {
  return 1 / (1 + 10 ** ((botElo - rating) / 400))
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

function growRd(rd: number, lastGameAt: number | null, now: number): number {
  let r = rd
  if (lastGameAt !== null) {
    const idleDays = Math.max(0, (now - lastGameAt) / DAY_MS)
    const blocks = Math.floor(idleDays / RD_IDLE_DAYS)
    if (blocks > 0) r = Math.min(RD_MAX, r + RD_IDLE_GROWTH * blocks)
  }
  return r
}

/**
 * Rating update after one game (spec 7.3). Pure: `summary.endedAt` is the clock.
 * Result target: the rating at which this game would have been exactly expected (short losses weigh more).
 * Blended with the ACPL target when analysis exists; the ACPL weight is tapered by rating (acplWeight).
 * The step is kFactor(games) * (target - rating); the positive part is cut by hints used.
 * The total change is clamped to +-MAX_RATING_STEP.
 */
export function updateAfterGame(state: PlayerState, summary: GameSummary): UpdateResult {
  const rating = state.rating
  const expected = expectedScore(rating, summary.botElo)
  const diff = summary.result - expected

  // Quick loss: the bot was too hard. Lost ground counts more.
  const quickLoss = summary.result === 0 && summary.plies < SHORT_LOSS_PLIES
  const weighted = diff < 0 && quickLoss ? diff * SHORT_LOSS_MULT : diff
  // Result target in Elo: the rating that would make this game's score exactly expected.
  const slope = (Math.LN10 / 400) * expected * (1 - expected)
  const resultTarget = rating + clamp(weighted / slope, -RESULT_TARGET_MAX, RESULT_TARGET_MAX)

  let target = resultTarget
  if (summary.acpl !== null) {
    const moves = Math.max(1, Math.ceil(summary.plies / 2))
    const blunderRate = Math.min(1, summary.blunders / moves)
    const acplElo = acplToElo(summary.acpl) - BLUNDER_ELO_PER_RATE * blunderRate
    const w = acplWeight(rating)
    target = (1 - w) * resultTarget + w * acplElo
  }

  let delta = kFactor(state.games) * (target - rating)
  if (delta > 0) {
    const hintPenalty = Math.min(HINT_GAIN_MAX_PENALTY, HINT_GAIN_STEP * summary.hintsUsed)
    delta *= 1 - hintPenalty
  }
  delta = clamp(delta, -MAX_RATING_STEP, MAX_RATING_STEP)
  const newRating = clamp(rating + delta, RATING_MIN, RATING_MAX)
  const realDelta = newRating - rating

  const entry: RecentGame = { result: summary.result, botElo: summary.botElo }
  const recent = [...state.recent, entry].slice(-RECENT_CAP)
  const rd = Math.max(RD_MIN, growRd(state.rd, state.lastGameAt, summary.endedAt) * RD_GAME_DECAY)

  return {
    state: {
      rating: newRating,
      rd,
      games: state.games + 1,
      lastGameAt: summary.endedAt,
      recent,
      botElo: summary.botElo,
    },
    delta: realDelta,
  }
}
