// Turns a skill number into a move: search plus the human-like weakening levers.
import { F_CAP, Position, mFlags, mPromo } from './board'
import { bookMove } from './book'
import { levelFor } from './levels'
import { type Limits, MATE, Searcher } from './search'

export interface BotContext {
  /** UCI moves played since the start position */
  uciHistory?: string[]
  /** true when the game began from the standard position (book is only used then) */
  standardStart?: boolean
  /** mid-game easing: more noise and blunders for the rest of the game */
  easing?: boolean
  rng?: () => number
  stop?: () => boolean
  /** override the level time cap */
  timeCapMs?: number
}

export interface BotMove {
  move: number
  evalCp: number
  depth: number
  nodes: number
  timeMs: number
  fromBook: boolean
}

interface Scored {
  move: number
  score: number
}

export class Bot {
  readonly searcher: Searcher
  constructor(ttBits = 18) {
    this.searcher = new Searcher(ttBits)
  }

  cancel(): void {
    this.searcher.cancel()
  }

  choose(pos: Position, skill: number, ctx: BotContext = {}): BotMove | null {
    const rng = ctx.rng ?? Math.random
    const level = levelFor(skill)
    const t0 = performance.now()
    const legal = pos.legalMoves()
    if (!legal.length) return null
    const done = (move: number, evalCp: number, depth: number, nodes: number, fromBook = false): BotMove => ({
      move,
      evalCp,
      depth,
      nodes,
      timeMs: performance.now() - t0,
      fromBook,
    })
    if (legal.length === 1) return done(legal[0]!, 0, 0, 0)

    if (ctx.standardStart && ctx.uciHistory && rng() < level.book) {
      const uci = bookMove(ctx.uciHistory, rng)
      if (uci) {
        const m = pos.parseUci(uci)
        if (m >= 0) return done(m, 0, 0, 0, true)
      }
    }

    if (level.depth === 0) return done(this.randomMove(legal, rng), 0, 0, 0)

    const easing = !!ctx.easing
    const noise = level.noise * (easing ? 1.25 : 1) + (easing ? 10 : 0)
    const blunder = Math.min(0.5, level.blunder + (easing ? 0.04 : 0))
    const topK = level.topK
    const spread = level.spread + (easing ? 15 : 0)
    const timeMs = Math.min(ctx.timeCapMs ?? 2300, level.timeMs, 2300)

    const limits: Limits = {
      maxDepth: level.depth,
      maxNodes: Math.max(1500, level.nodes),
      timeMs,
      qDepth: level.qDepth,
      nullMove: level.nullMove,
      lmr: level.lmr,
    }

    // Tactics blindness: a 1-ply look without quiescence. Grabs bait and misses recaptures.
    if (rng() < level.blind) {
      const r = this.searcher.scoreRootMoves(pos, { ...limits, maxDepth: 1, qDepth: 0 }, ctx.stop)
      const pick = this.pick(r.scores, rng, 40, 2, 60, 0, skill)
      return done(pick.move, pick.score, 1, this.searcher.nodeCount)
    }

    if (noise <= 0 && topK <= 1 && blunder <= 0) {
      const r = this.searcher.search(pos, limits, ctx.stop)
      return done(r.move, r.score, r.depth, r.nodes)
    }
    const r = this.searcher.scoreRootMoves(pos, limits, ctx.stop)
    const pick = this.pick(r.scores, rng, noise, topK, spread, blunder, skill)
    return done(pick.move, pick.score, r.depth, this.searcher.nodeCount)
  }

  private randomMove(legal: number[], rng: () => number): number {
    const w = legal.map((m) => (mPromo(m) ? 6 : mFlags(m) & F_CAP ? 4 : 1))
    let tot = 0
    for (const x of w) tot += x
    let r = rng() * tot
    for (let i = 0; i < legal.length; i++) {
      r -= w[i]!
      if (r <= 0) return legal[i]!
    }
    return legal[legal.length - 1]!
  }

  private pick(
    scores: Scored[],
    rng: () => number,
    noise: number,
    topK: number,
    spread: number,
    blunder: number,
    skill: number,
  ): Scored {
    const sorted = [...scores].sort((a, b) => b.score - a.score)
    const trueBest = sorted[0]!
    // never miss a one-move mate above skill 40
    if (skill > 40 && trueBest.score >= MATE - 3) return trueBest
    // blunder: a clearly worse move, never one that hangs the queen above skill 25
    if (blunder > 0 && rng() < blunder) {
      const maxLoss = skill > 25 ? 350 : 800
      const pool = sorted.filter((s) => trueBest.score - s.score >= 90 && trueBest.score - s.score <= maxLoss)
      if (pool.length && trueBest.score < MATE - 300) return pool[Math.floor(rng() * pool.length)]!
    }
    const noisy = sorted
      .map((s) => ({ ...s, n: s.score + (noise > 0 ? (rng() * 2 - 1) * noise : 0) }))
      .sort((a, b) => b.n - a.n)
    const best = noisy[0]!
    const cands = noisy.slice(0, Math.max(1, topK)).filter((c) => best.n - c.n <= spread)
    if (cands.length === 1) return best
    const temp = Math.max(8, spread / 2)
    const w = cands.map((c) => Math.exp(-(best.n - c.n) / temp))
    let tot = 0
    for (const x of w) tot += x
    let r = rng() * tot
    for (let i = 0; i < cands.length; i++) {
      r -= w[i]!
      if (r <= 0) return cands[i]!
    }
    return best
  }
}
