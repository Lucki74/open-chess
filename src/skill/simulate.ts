// Shared synthetic-player run used by tools/simulate-players.ts.
import { skillForElo } from '../engine/levels'
import { chooseBotSkill } from './adapt'
import { summarize } from './analysis'
import { MAX_RATING_STEP } from './constants'
import { playMatch, type Side } from './simgame'
import { initialPlayerState, updateAfterGame } from './rating'
import type { PlayerState } from './types'

const DAY_MS = 86_400_000

/** FNV-style integer mix so every (seed, elo, game, role) gets its own deterministic stream. */
export function mixSeed(...parts: number[]): number {
  let h = 2166136261
  for (const p of parts) {
    h ^= p >>> 0
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface GameLog {
  game: number
  playerColour: Side
  skill: number
  botElo: number
  /** player result, 1 / 0.5 / 0 */
  result: number
  acpl: number | null
  blunders: number
  plies: number
  easingApplied: boolean
  ratingAfter: number
  delta: number
}

export interface PlayerRun {
  trueElo: number
  trueSkill: number
  seed: number
  timeCapMs: number
  games: GameLog[]
  final: PlayerState
}

export function runSyntheticPlayer(opts: { trueElo: number; seed: number; games: number; timeCapMs: number; analysisDepth?: number }): PlayerRun {
  const trueSkill = skillForElo(opts.trueElo)
  let state = initialPlayerState()
  const games: GameLog[] = []
  for (let g = 0; g < opts.games; g++) {
    const choice = chooseBotSkill(state)
    const playerColour: Side = g % 2 === 0 ? 'white' : 'black'
    const botColour: Side = playerColour === 'white' ? 'black' : 'white'
    const base = mixSeed(opts.seed, opts.trueElo, g)
    const playerSide = { skill: trueSkill, seed: mixSeed(base, 1), analyse: true }
    const botSide = { skill: choice.skill, seed: mixSeed(base, 2), analyse: false }
    const res = playMatch({
      white: playerColour === 'white' ? playerSide : botSide,
      black: playerColour === 'black' ? playerSide : botSide,
      seed: mixSeed(base, 3),
      timeCapMs: opts.timeCapMs,
      openingPlies: 2,
      analysisDepth: opts.analysisDepth ?? 3,
      easingOf: playerColour,
    })
    const playerResult = res.result === 0 ? 0.5 : res.result === (playerColour === 'white' ? 1 : -1) ? 1 : 0
    const sum = summarize(res.losses[playerColour])
    const upd = updateAfterGame(state, {
      result: playerResult,
      acpl: sum.acpl,
      blunders: sum.blunders,
      plies: res.plies,
      hintsUsed: 0,
      botElo: choice.botElo,
      endedAt: g * DAY_MS,
    })
    games.push({
      game: g + 1,
      playerColour,
      skill: choice.skill,
      botElo: choice.botElo,
      result: playerResult,
      acpl: sum.acpl === null ? null : Math.round(sum.acpl * 10) / 10,
      blunders: sum.blunders,
      plies: res.plies,
      easingApplied: res.easingApplied,
      ratingAfter: Math.round(upd.state.rating),
      delta: Math.round(upd.delta * 10) / 10,
    })
    state = upd.state
  }
  return { trueElo: opts.trueElo, trueSkill, seed: opts.seed, timeCapMs: opts.timeCapMs, games, final: state }
}

export interface Verdict {
  ratingAt15: number
  errorAt15: number
  scoreGames10to40: number
  maxLossStreakAfter5: number
  maxStep: number
  pass: { estimate: boolean; score: boolean; streak: boolean; clamp: boolean }
  ok: boolean
}

export function judge(run: PlayerRun): Verdict {
  const g = run.games
  const ratingAt15 = g[14]?.ratingAfter ?? NaN
  const errorAt15 = ratingAt15 - run.trueElo
  const window = g.slice(9, 40)
  const scoreGames10to40 = window.reduce((a, x) => a + x.result, 0) / Math.max(1, window.length)
  let streak = 0
  let maxStreak = 0
  for (const x of g.slice(5)) {
    streak = x.result === 0 ? streak + 1 : 0
    maxStreak = Math.max(maxStreak, streak)
  }
  const maxStep = Math.max(0, ...g.map((x) => Math.abs(x.delta)))
  const pass = {
    estimate: Math.abs(errorAt15) <= 150,
    score: scoreGames10to40 >= 0.4 && scoreGames10to40 <= 0.7,
    streak: maxStreak <= 4,
    clamp: maxStep <= MAX_RATING_STEP,
  }
  return {
    ratingAt15,
    errorAt15,
    scoreGames10to40,
    maxLossStreakAfter5: maxStreak,
    maxStep,
    pass,
    ok: pass.estimate && pass.score && pass.streak && pass.clamp,
  }
}
