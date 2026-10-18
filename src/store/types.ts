export const SCHEMA_VERSION = 1 as const
export const MAX_GAMES = 200

export type Color = 'w' | 'b'
export type GameResult = 'win' | 'loss' | 'draw'

export interface GameRecord {
  id: string
  startedAt: string
  playerColor: Color
  result: GameResult
  termination: string
  moves: string[]
  fenStart: string
  botSkill: number
  playerRatingBefore: number
  playerRatingAfter: number
  acpl: number | null
  easingApplied: boolean
  hintsUsed: number
}

export interface InProgressGame {
  id: string
  startedAt: string
  playerColor: Color
  fenStart: string
  moves: string[]
  uci: string[]
  botSkill: number
  playerRatingBefore: number
  undosUsed: number
  hintsUsed: number
  easingApplied: boolean
  losses: number[]
}

export interface StoreData {
  version: typeof SCHEMA_VERSION
  games: GameRecord[]
  /** Opaque PlayerState blob owned by src/skill. */
  player: unknown | null
  inProgress: InProgressGame | null
  muted: boolean
}

export function defaultStore(): StoreData {
  return { version: SCHEMA_VERSION, games: [], player: null, inProgress: null, muted: false }
}
