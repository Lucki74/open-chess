// Every tunable of the adaptive skill system lives here. Engine levers live in src/engine/levels.ts.

export const START_RATING = 800
export const START_RD = 350
export const RATING_MIN = 200
export const RATING_MAX = 2800

/** Bot Elo = player rating + BOT_OFFSET before streak nudges. */
export const BOT_OFFSET = -20
/** Target long-run player score. */
export const TARGET_SCORE = 0.55

/** Blend of result-based update and ACPL-based estimate. */
export const BLEND_RESULT = 0.75
export const BLEND_ACPL = 0.25

/** K-factor: starts at K_START, decays linearly to K_END over K_DECAY_GAMES games. */
export const K_START = 64
export const K_END = 24
export const K_DECAY_GAMES = 15

/** First games are silent placement: larger steps. */
export const PLACEMENT_GAMES = 3
export const PLACEMENT_K_MULT = 1.5

/** Max change of the rating per game (absolute Elo). */
export const MAX_RATING_STEP = 150

/** Hidden blunder penalty on the ACPL estimate: Elo lost per unit of blunder rate (0..1). */
export const BLUNDER_ELO_PER_RATE = 150

/** Losses shorter than this many plies count as a stronger "too hard" signal. */
export const SHORT_LOSS_PLIES = 30
export const SHORT_LOSS_MULT = 1.5

/** Hints shave gain from wins. Each hint removes HINT_GAIN_STEP of the positive gain, capped. */
export const HINT_GAIN_STEP = 0.05
export const HINT_GAIN_MAX_PENALTY = 0.25

/** Rating deviation: decays per game, grows per idle block beyond RD_IDLE_DAYS. */
export const RD_MIN = 60
export const RD_MAX = 350
export const RD_GAME_DECAY = 0.95
export const RD_IDLE_DAYS = 30
export const RD_IDLE_GROWTH = 20

/** Streak rules (bot Elo nudges). */
export const LOSS_STREAK_2_ADJ = -80
export const LOSS_STREAK_3_ADJ = -150
export const WIN_STREAK_3_ADJ = 100
/** Bot level progression limits. */
export const BOT_RISE_PER_GAME = 100
export const BOT_RISE_PER_3_GAMES = 250

/** Mid-game easing (player-relative eval, centipawns). */
export const EASE_PLAYER_EVAL_CP = -500
export const EASE_BEFORE_PLY = 40
/** the loss must hold this many plies in a row (filters one-ply eval spikes) */
export const EASE_SUSTAIN_PLIES = 4
export const CRUSH_PLAYER_EVAL_CP = 800
export const CRUSH_PLIES = 6

/** Move quality. */
export const CP_LOSS_CAP = 500
export const MATE_CLAMP_CP = 1000
export const BLUNDER_CP = 200
export const ANALYSIS_DEPTH = 3

/**
 * ACPL -> Elo curve (ascending ACPL, descending Elo). Source: tools/acpl-fit.ts, 16 games per skill,
 * depth-3 analysis. Least-squares fit Elo = 2867 - 513 ln(ACPL) over the 11 skill rows, sampled here.
 * Isotonic (PAV) fit was too steep at ACPL 10 to 15 and too noisy at 60 to 70, so it is not used.
 */
export const ACPL_ELO_CURVE: readonly [number, number][] = [
  [5, 2040],
  [7, 1870],
  [10, 1690],
  [15, 1480],
  [20, 1330],
  [30, 1120],
  [40, 975],
  [50, 860],
  [60, 770],
  [70, 690],
  [100, 510],
  [150, 300],
]
