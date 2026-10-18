export type GameResult = 1 | 0.5 | 0

export interface RecentGame {
  result: GameResult
  /** bot Elo the player faced in that game */
  botElo: number
}

/** Hidden player model. Never shown in the UI. */
export interface PlayerState {
  rating: number
  rd: number
  games: number
  /** epoch ms of the last finished game, null before the first game */
  lastGameAt: number | null
  /** last RECENT_CAP games, oldest first */
  recent: RecentGame[]
  /** bot Elo used in the most recent game */
  botElo: number
}

export interface GameSummary {
  /** result from the player's view */
  result: GameResult
  /** player ACPL, null when no move was analysed */
  acpl: number | null
  blunders: number
  /** total plies in the game */
  plies: number
  hintsUsed: number
  /** bot Elo the player faced */
  botElo: number
  /** epoch ms; also the "now" for rd growth */
  endedAt: number
}

export interface UpdateResult {
  state: PlayerState
  /** signed rating change, already clamped */
  delta: number
}

export interface BotChoice {
  botElo: number
  skill: number
}

export interface EasingState {
  /** true when the bot must play with easing (noise and blunders raised) */
  easing: boolean
  /** true once easing has fired in this game (for the saved record only) */
  easingApplied: boolean
}
