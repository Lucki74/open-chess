// Headless game playing used by self-play tools and tests.
import { Position, START_FEN } from './board'
import { Bot } from './bot'
import { Searcher } from './search'

export type Mover = (pos: Position, uciHistory: string[]) => number | null

export function rngFrom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function botMover(skill: number, rng: () => number, timeCapMs = 150, bot = new Bot(16)): Mover {
  return (pos, hist) => {
    const r = bot.choose(pos, skill, { uciHistory: hist, standardStart: true, rng, timeCapMs })
    return r ? r.move : null
  }
}

export function fixedDepthMover(depth: number): Mover {
  const s = new Searcher(16)
  return (pos) => {
    const r = s.search(pos, { maxDepth: depth, maxNodes: 1e9, timeMs: 60000, qDepth: 8, nullMove: true, lmr: true })
    return r.move || null
  }
}

export interface GameOutcome {
  /** +1 white wins, -1 black wins, 0 draw */
  result: 1 | 0 | -1
  plies: number
  uci: string[]
  termination: string
}

export function playGame(
  white: Mover,
  black: Mover,
  opts: { openingPlies?: number; rng: () => number; maxPlies?: number; startFen?: string },
): GameOutcome {
  const pos = new Position(opts.startFen ?? START_FEN)
  const hist: string[] = []
  const maxPlies = opts.maxPlies ?? 300
  const opening = opts.openingPlies ?? 0
  for (;;) {
    const legal = pos.legalMoves()
    if (!legal.length)
      return pos.inCheck()
        ? { result: pos.side === 0 ? -1 : 1, plies: hist.length, uci: hist, termination: 'checkmate' }
        : { result: 0, plies: hist.length, uci: hist, termination: 'stalemate' }
    if (pos.halfmove >= 100) return { result: 0, plies: hist.length, uci: hist, termination: 'fifty' }
    if (pos.repetitions() >= 3) return { result: 0, plies: hist.length, uci: hist, termination: 'repetition' }
    if (pos.insufficientMaterial()) return { result: 0, plies: hist.length, uci: hist, termination: 'material' }
    if (hist.length >= maxPlies) return { result: 0, plies: hist.length, uci: hist, termination: 'maxplies' }
    let m: number | null
    if (hist.length < opening) m = legal[Math.floor(opts.rng() * legal.length)]!
    else m = (pos.side === 0 ? white : black)(pos, hist)
    if (m === null || !legal.includes(m)) throw new Error(`illegal or missing move at ply ${hist.length}: ${pos.toFen()}`)
    hist.push(pos.moveToUci(m))
    pos.makeMove(m)
  }
}

/** Elo difference implied by a score fraction (0..1), clamped to +-800. */
export function eloFromScore(score: number): number {
  const s = Math.min(0.99, Math.max(0.01, score))
  return Math.max(-800, Math.min(800, -400 * Math.log10(1 / s - 1)))
}
