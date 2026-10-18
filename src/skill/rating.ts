import {
  ACPL_ELO_CURVE,
  BLEND_ACPL,
  BLEND_RESULT,
  BLUNDER_ELO_PER_RATE,
  CP_LOSS_CAP,
  HINT_GAIN_MAX_PENALTY,
  HINT_GAIN_STEP,
  K_DECAY_GAMES,
  K_END,
  K_START,
  MATE_CLAMP_CP,
  MAX_RATING_STEP,
  PLACEMENT_GAMES,
  PLACEMENT_K_MULT,
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

/** K decays linearly from K_START to K_END over K_DECAY_GAMES games. */
export function kFactor(games: number): number {
  const t = Math.min(1, games / K_DECAY_GAMES)
  return K_START + (K_END - K_START) * t
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
 * Result term: rating + K * (S - E), short losses weigh more, placement K is larger.
 * Blended 0.6 / 0.4 with the ACPL estimate when analysis exists.
 * The positive part is cut by hints used. The total change is clamped to +-MAX_RATING_STEP.
 */
export function updateAfterGame(state: PlayerState, summary: GameSummary): UpdateResult {
  const rating = state.rating
  const expected = expectedScore(rating, summary.botElo)
  const diff = summary.result - expected

  let k = kFactor(state.games)
  if (state.games < PLACEMENT_GAMES) k *= PLACEMENT_K_MULT
  // Quick loss: the bot was too hard. Lost ground counts more.
  const quickLoss = summary.result === 0 && summary.plies < SHORT_LOSS_PLIES
  const weighted = diff < 0 && quickLoss ? diff * SHORT_LOSS_MULT : diff
  const resultRating = rating + k * weighted

  let candidate = resultRating
  if (summary.acpl !== null) {
    const moves = Math.max(1, Math.ceil(summary.plies / 2))
    const blunderRate = Math.min(1, summary.blunders / moves)
    const acplElo = acplToElo(summary.acpl) - BLUNDER_ELO_PER_RATE * blunderRate
    candidate = BLEND_RESULT * resultRating + BLEND_ACPL * acplElo
  }

  let delta = candidate - rating
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
