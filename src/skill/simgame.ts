// Headless two-bot match with optional per-side ACPL analysis and easing. Used by the simulation tools.
import { Position, START_FEN, WHITE } from '../engine/board'
import { Bot } from '../engine/bot'
import { rngFrom } from '../engine/match'
import { EasingTracker } from './adapt'
import { moveQuality } from './analysis'
import { Searcher } from '../engine/search'

export type Side = 'white' | 'black'

export interface MatchSide {
  skill: number
  seed: number
  /** record ACPL-relevant cp losses for this side's moves */
  analyse: boolean
}

export interface MatchOptions {
  white: MatchSide
  black: MatchSide
  /** seeds the random opening plies */
  seed: number
  timeCapMs: number
  openingPlies: number
  analysisDepth: number
  /** this side is the player: its eval drives easing of the other side */
  easingOf?: Side
  maxPlies?: number
}

export interface MatchResult {
  /** +1 white wins, -1 black wins, 0 draw */
  result: 1 | 0 | -1
  plies: number
  losses: Record<Side, number[]>
  easingApplied: boolean
  termination: string
}

let easingSearcher: Searcher | null = null

/** Side-to-move score for easing decisions: a depth-2 search, the same kind of score the app has at hand. */
function easingEval(pos: Position): number {
  if (!easingSearcher) easingSearcher = new Searcher(16)
  return easingSearcher.search(pos, { maxDepth: 2, maxNodes: 1e9, timeMs: 1e9, qDepth: 6, nullMove: false, lmr: false }).score
}

export function playMatch(opts: MatchOptions): MatchResult {
  const pos = new Position(START_FEN)
  const hist: string[] = []
  const sides: Record<Side, MatchSide> = { white: opts.white, black: opts.black }
  const bots: Record<Side, Bot> = { white: new Bot(16), black: new Bot(16) }
  const rngs: Record<Side, () => number> = { white: rngFrom(opts.white.seed), black: rngFrom(opts.black.seed) }
  const openRng = rngFrom(opts.seed)
  const losses: Record<Side, number[]> = { white: [], black: [] }
  const tracker = opts.easingOf ? new EasingTracker() : null
  const maxPlies = opts.maxPlies ?? 300
  let easing = false

  const end = (result: 1 | 0 | -1, termination: string): MatchResult => ({
    result,
    plies: hist.length,
    losses,
    easingApplied: tracker?.easingApplied ?? false,
    termination,
  })

  for (;;) {
    const legal = pos.legalMoves()
    if (!legal.length)
      return pos.inCheck() ? end(pos.side === WHITE ? -1 : 1, 'checkmate') : end(0, 'stalemate')
    if (pos.halfmove >= 100) return end(0, 'fifty')
    if (pos.repetitions() >= 3) return end(0, 'repetition')
    if (pos.insufficientMaterial()) return end(0, 'material')
    if (hist.length >= maxPlies) return end(0, 'maxplies')

    const key: Side = pos.side === WHITE ? 'white' : 'black'
    const spec = sides[key]
    const fen = pos.toFen()
    let m: number
    if (hist.length < opts.openingPlies) {
      m = legal[Math.floor(openRng() * legal.length)]!
    } else {
      const useEasing = easing && tracker !== null && key !== opts.easingOf
      const r = bots[key].choose(pos, spec.skill, {
        uciHistory: hist,
        standardStart: true,
        rng: rngs[key],
        timeCapMs: opts.timeCapMs,
        easing: useEasing,
      })
      if (!r) throw new Error(`no move at ply ${hist.length}`)
      m = r.move
    }
    if (!legal.includes(m)) throw new Error(`illegal move at ply ${hist.length}: ${fen}`)
    const uci = pos.moveToUci(m)
    if (spec.analyse && hist.length >= opts.openingPlies) {
      losses[key].push(moveQuality(fen, uci, opts.analysisDepth))
    }
    hist.push(uci)
    pos.makeMove(m)

    if (tracker) {
      const evNext = easingEval(pos) // side-to-move view
      const white = pos.side === WHITE ? evNext : -evNext
      const playerView = opts.easingOf === 'white' ? white : -white
      easing = tracker.observe(playerView, hist.length).easing
    }
  }
}
