import { eloForSkill, skillForElo } from '../engine/levels'
import {
  BOT_OFFSET,
  BOT_RISE_PER_3_GAMES,
  BOT_RISE_PER_GAME,
  CRUSH_PLAYER_EVAL_CP,
  CRUSH_PLIES,
  EASE_BEFORE_PLY,
  EASE_PLAYER_EVAL_CP,
  EASE_SUSTAIN_PLIES,
  LOSS_STREAK_2_ADJ,
  LOSS_STREAK_3_ADJ,
  WIN_STREAK_3_ADJ,
} from './constants'
import type { BotChoice, EasingState, PlayerState, RecentGame } from './types'

function trailingRun(recent: RecentGame[], result: 0 | 1): number {
  let n = 0
  for (let i = recent.length - 1; i >= 0 && recent[i]!.result === result; i--) n++
  return n
}

/**
 * Bot level for the next game (spec 7.4). Base is rating + BOT_OFFSET, streak nudges,
 * rise limits per game and per 3 games, then clamped to the skill range.
 */
export function chooseBotSkill(state: PlayerState): BotChoice {
  const losses = trailingRun(state.recent, 0)
  const wins = trailingRun(state.recent, 1)
  let adj = 0
  if (losses >= 3) adj = LOSS_STREAK_3_ADJ
  else if (losses === 2) adj = LOSS_STREAK_2_ADJ
  else if (wins >= 3) adj = WIN_STREAK_3_ADJ

  let elo = state.rating + BOT_OFFSET + adj
  if (state.games > 0) {
    elo = Math.min(elo, state.botElo + BOT_RISE_PER_GAME)
    if (state.recent.length >= 3) {
      const threeAgo = state.recent[state.recent.length - 3]!.botElo
      elo = Math.min(elo, threeAgo + BOT_RISE_PER_3_GAMES)
    }
  }
  elo = Math.max(eloForSkill(0), Math.min(eloForSkill(100), elo))
  return { botElo: elo, skill: skillForElo(elo) }
}

/**
 * Mid-game easing (spec 7.5). Feed the player's eval after every ply.
 * Easing latches once, when the player is lost (< -500 cp) before ply EASE_BEFORE_PLY.
 * A crushing player (> +800 cp for CRUSH_PLIES plies in a row) turns easing off for good.
 * Never announced; the caller stores easingApplied in the game record.
 */
export class EasingTracker {
  easingApplied = false
  private crushed = false
  private crushRun = 0
  private lostRun = 0

  observe(evalCpForPlayer: number, plyIndex: number): EasingState {
    this.crushRun = evalCpForPlayer > CRUSH_PLAYER_EVAL_CP ? this.crushRun + 1 : 0
    if (this.crushRun >= CRUSH_PLIES) this.crushed = true
    this.lostRun = evalCpForPlayer < EASE_PLAYER_EVAL_CP ? this.lostRun + 1 : 0
    if (!this.easingApplied && !this.crushed && plyIndex < EASE_BEFORE_PLY && this.lostRun >= EASE_SUSTAIN_PLIES) {
      this.easingApplied = true
    }
    return { easing: this.easingApplied && !this.crushed, easingApplied: this.easingApplied }
  }
}
