// Alpha-beta search: negamax, iterative deepening, PVS, TT, killers/history, quiescence,
// check extension, optional null-move pruning and late move reductions.
import { F_CAP, Position, mFlags, mFrom, mPromo, mTo } from './board'
import { VALUE, evaluate } from './eval'

export const MATE = 30000
export const INF = 32000
const MATE_BOUND = MATE - 256
const MAX_PLY = 96

export interface Limits {
  maxDepth: number
  maxNodes: number
  timeMs: number
  /** quiescence depth limit; 0 turns quiescence off */
  qDepth: number
  nullMove: boolean
  lmr: boolean
}

export interface SearchResult {
  move: number
  score: number
  depth: number
  nodes: number
  timeMs: number
}

export interface RootScore {
  move: number
  score: number
}

class Abort {}

const TT_EXACT = 0
const TT_LOWER = 1
const TT_UPPER = 2

export class Searcher {
  private ttBits: number
  private ttKeyHi: Int32Array
  private ttKeyLo: Int32Array
  private ttMove: Int32Array
  private ttScore: Int16Array
  private ttDepth: Int8Array
  private ttFlag: Uint8Array
  private killers = new Int32Array(MAX_PLY * 2)
  private history = new Int32Array(2 * 128 * 128)
  private lists: Int32Array[] = []
  private scores: Int32Array[] = []
  private nodes = 0
  private startTime = 0
  private deadline = 0
  private limits: Limits = { maxDepth: 1, maxNodes: 1e9, timeMs: 1000, qDepth: 8, nullMove: true, lmr: true }
  private cancelled = false
  private stopFn: (() => boolean) | null = null

  constructor(ttBits = 18) {
    this.ttBits = ttBits
    const n = 1 << ttBits
    this.ttKeyHi = new Int32Array(n)
    this.ttKeyLo = new Int32Array(n)
    this.ttMove = new Int32Array(n)
    this.ttScore = new Int16Array(n)
    this.ttDepth = new Int8Array(n).fill(-1)
    this.ttFlag = new Uint8Array(n)
    for (let i = 0; i < MAX_PLY + 4; i++) {
      this.lists.push(new Int32Array(256))
      this.scores.push(new Int32Array(256))
    }
  }

  clear(): void {
    this.ttDepth.fill(-1)
    this.killers.fill(0)
    this.history.fill(0)
  }

  cancel(): void {
    this.cancelled = true
  }

  private checkStop(): void {
    if (this.cancelled) throw new Abort()
    if (this.nodes >= this.limits.maxNodes) throw new Abort()
    if ((this.nodes & 1023) === 0) {
      if (performance.now() > this.deadline) throw new Abort()
      if (this.stopFn && this.stopFn()) throw new Abort()
    }
  }

  private begin(limits: Limits): void {
    this.limits = limits
    this.nodes = 0
    this.cancelled = false
    this.startTime = performance.now()
    this.deadline = this.startTime + limits.timeMs
    this.killers.fill(0)
    for (let i = 0; i < this.history.length; i++) this.history[i] = this.history[i]! >> 3
  }

  private isRepetition(pos: Position): boolean {
    const lim = Math.max(0, pos.ply - pos.halfmove)
    for (let i = pos.ply - 2; i >= lim; i -= 2) {
      if (pos.hLo[i] === pos.hashLo && pos.hHi[i] === pos.hashHi) return true
    }
    return false
  }

  private orderMoves(pos: Position, list: Int32Array, n: number, ttMove: number, ply: number): Int32Array {
    const sc = this.scores[ply]!
    const b = pos.board
    const k0 = this.killers[ply * 2]!
    const k1 = this.killers[ply * 2 + 1]!
    const side = pos.side
    for (let i = 0; i < n; i++) {
      const m = list[i]!
      let s: number
      if (m === ttMove) s = 10_000_000
      else {
        const flags = mFlags(m)
        const promo = mPromo(m)
        if (flags & F_CAP) {
          const victim = flags & 2 ? 1 : b[mTo(m)]! & 7
          const attacker = b[mFrom(m)]! & 7
          s = 1_000_000 + victim * 16 - attacker + (promo ? VALUE[promo]! : 0)
        } else if (promo) s = 900_000 + promo
        else if (m === k0) s = 800_000
        else if (m === k1) s = 700_000
        else s = this.history[(side * 128 + mFrom(m)) * 128 + mTo(m)]!
      }
      sc[i] = s
    }
    return sc
  }

  private qsearch(pos: Position, alpha: number, beta: number, ply: number, qd: number): number {
    this.nodes++
    this.checkStop()
    const stand = evaluate(pos)
    if (stand >= beta) return stand
    if (qd >= this.limits.qDepth || ply >= MAX_PLY - 1) return stand
    if (stand < alpha - 1100) return alpha
    if (stand > alpha) alpha = stand
    const list = this.lists[ply]!
    const n = pos.generate(list, true)
    const sc = this.orderMoves(pos, list, n, 0, ply)
    const us = pos.side
    let best = stand
    for (let i = 0; i < n; i++) {
      // selection sort step
      let bi = i
      for (let j = i + 1; j < n; j++) if (sc[j]! > sc[bi]!) bi = j
      if (bi !== i) {
        const tm = list[i]!
        list[i] = list[bi]!
        list[bi] = tm
        const ts = sc[i]!
        sc[i] = sc[bi]!
        sc[bi] = ts
      }
      const m = list[i]!
      const flags = mFlags(m)
      const victim = flags & 2 ? 1 : pos.board[mTo(m)]! & 7
      const promo = mPromo(m)
      // delta cut-off
      if (stand + VALUE[victim]! + (promo ? VALUE[promo]! - 100 : 0) + 200 < alpha) continue
      pos.makeMove(m)
      if (pos.isAttacked(pos.kingSq[us]!, us ^ 1)) {
        pos.unmakeMove()
        continue
      }
      const score = -this.qsearch(pos, -beta, -alpha, ply + 1, qd + 1)
      pos.unmakeMove()
      if (score > best) {
        best = score
        if (score > alpha) {
          alpha = score
          if (score >= beta) return score
        }
      }
    }
    return best
  }

  private negamax(pos: Position, depth: number, alpha: number, beta: number, ply: number, allowNull: boolean): number {
    this.nodes++
    this.checkStop()
    if (ply > 0) {
      if (pos.halfmove >= 100 || this.isRepetition(pos) || pos.insufficientMaterial()) return 0
      // mate distance pruning
      const mating = MATE - ply
      if (mating < beta) {
        beta = mating
        if (alpha >= beta) return beta
      }
      const mated = -MATE + ply
      if (mated > alpha) {
        alpha = mated
        if (alpha >= beta) return alpha
      }
    }
    const us = pos.side
    const inCheck = pos.isAttacked(pos.kingSq[us]!, us ^ 1)
    if (inCheck && ply < MAX_PLY - 8) depth++
    if (depth <= 0 || ply >= MAX_PLY - 2) {
      if (this.limits.qDepth > 0) return this.qsearch(pos, alpha, beta, ply, 0)
      return evaluate(pos)
    }

    // transposition table
    const idx = pos.hashLo & ((1 << this.ttBits) - 1)
    let ttMove = 0
    if (this.ttDepth[idx]! >= 0 && this.ttKeyLo[idx] === pos.hashLo && this.ttKeyHi[idx] === pos.hashHi) {
      ttMove = this.ttMove[idx]!
      if (this.ttDepth[idx]! >= depth && ply > 0) {
        let s = this.ttScore[idx]!
        if (s > MATE_BOUND) s -= ply
        else if (s < -MATE_BOUND) s += ply
        const fl = this.ttFlag[idx]!
        if (fl === TT_EXACT) return s
        if (fl === TT_LOWER && s >= beta) return s
        if (fl === TT_UPPER && s <= alpha) return s
      }
    }

    const pv = beta - alpha > 1
    // null move pruning
    if (this.limits.nullMove && allowNull && !inCheck && !pv && depth >= 3 && beta < MATE_BOUND) {
      let material = 0
      for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) {
          const p = pos.board[r * 16 + f]!
          if (p && p >> 3 === us) {
            const t = p & 7
            if (t > 1 && t < 6) material++
          }
        }
      if (material > 0 && evaluate(pos) >= beta) {
        pos.makeNull()
        const R = depth > 6 ? 3 : 2
        const s = -this.negamax(pos, depth - 1 - R, -beta, -beta + 1, ply + 1, false)
        pos.unmakeNull()
        if (s >= beta) return s >= MATE_BOUND ? beta : s
      }
    }

    const list = this.lists[ply]!
    const n = pos.generate(list)
    const sc = this.orderMoves(pos, list, n, ttMove, ply)
    let best = -INF
    let bestMove = 0
    let legal = 0
    const origAlpha = alpha
    for (let i = 0; i < n; i++) {
      let bi = i
      for (let j = i + 1; j < n; j++) if (sc[j]! > sc[bi]!) bi = j
      if (bi !== i) {
        const tm = list[i]!
        list[i] = list[bi]!
        list[bi] = tm
        const ts = sc[i]!
        sc[i] = sc[bi]!
        sc[bi] = ts
      }
      const m = list[i]!
      pos.makeMove(m)
      if (pos.isAttacked(pos.kingSq[us]!, us ^ 1)) {
        pos.unmakeMove()
        continue
      }
      legal++
      const quiet = !(mFlags(m) & F_CAP) && !mPromo(m)
      let score: number
      if (legal === 1) {
        score = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true)
      } else {
        let red = 0
        if (this.limits.lmr && depth >= 3 && legal > 4 && quiet && !inCheck) {
          red = legal > 8 ? 2 : 1
          if (pos.inCheck()) red = 0
        }
        score = -this.negamax(pos, depth - 1 - red, -alpha - 1, -alpha, ply + 1, true)
        if (score > alpha && red > 0) score = -this.negamax(pos, depth - 1, -alpha - 1, -alpha, ply + 1, true)
        if (score > alpha && score < beta) score = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true)
      }
      pos.unmakeMove()
      if (score > best) {
        best = score
        bestMove = m
        if (score > alpha) {
          alpha = score
          if (score >= beta) {
            if (quiet) {
              if (this.killers[ply * 2] !== m) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2]!
                this.killers[ply * 2] = m
              }
              const hi = (us * 128 + mFrom(m)) * 128 + mTo(m)
              this.history[hi] = Math.min(this.history[hi]! + depth * depth, 400_000)
            }
            break
          }
        }
      }
    }
    if (legal === 0) return inCheck ? -MATE + ply : 0

    // store
    if (this.ttDepth[idx]! <= depth || this.ttKeyLo[idx] !== pos.hashLo) {
      let s = best
      if (s > MATE_BOUND) s += ply
      else if (s < -MATE_BOUND) s -= ply
      this.ttKeyLo[idx] = pos.hashLo
      this.ttKeyHi[idx] = pos.hashHi
      this.ttMove[idx] = bestMove
      this.ttScore[idx] = s
      this.ttDepth[idx] = depth
      this.ttFlag[idx] = best <= origAlpha ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT
    }
    return best
  }

  private unwind(pos: Position, basePly: number): void {
    pos.unwindTo(basePly)
  }

  /** Iterative deepening from the current position. Returns the best move of the last completed depth. */
  search(pos: Position, limits: Limits, stop?: () => boolean): SearchResult {
    this.begin(limits)
    this.stopFn = stop ?? null
    const basePly = pos.ply
    const root = pos.legalMoves()
    if (!root.length) return { move: 0, score: pos.inCheck() ? -MATE : 0, depth: 0, nodes: 0, timeMs: 0 }
    let bestMove = root[0]!
    let bestScore = 0
    let doneDepth = 0
    const us = pos.side
    const list = this.lists[0]!
    for (let d = 1; d <= limits.maxDepth; d++) {
      try {
        // root move ordering: best first
        const idx = root.indexOf(bestMove)
        if (idx > 0) {
          root.splice(idx, 1)
          root.unshift(bestMove)
        }
        let alpha = -INF
        let iterBest = 0
        let iterScore = -INF
        for (let i = 0; i < root.length; i++) {
          const m = root[i]!
          pos.makeMove(m)
          let score: number
          if (i === 0) score = -this.negamax(pos, d - 1, -INF, -alpha, 1, true)
          else {
            score = -this.negamax(pos, d - 1, -alpha - 1, -alpha, 1, true)
            if (score > alpha) score = -this.negamax(pos, d - 1, -INF, -alpha, 1, true)
          }
          pos.unmakeMove()
          if (score > iterScore) {
            iterScore = score
            iterBest = m
            if (score > alpha) alpha = score
          }
        }
        bestMove = iterBest
        bestScore = iterScore
        doneDepth = d
        // store root in TT for next iteration
        const idxT = pos.hashLo & ((1 << this.ttBits) - 1)
        this.ttKeyLo[idxT] = pos.hashLo
        this.ttKeyHi[idxT] = pos.hashHi
        this.ttMove[idxT] = bestMove
        this.ttScore[idxT] = Math.max(-MATE_BOUND, Math.min(MATE_BOUND, bestScore))
        this.ttDepth[idxT] = d
        this.ttFlag[idxT] = TT_EXACT
        if (Math.abs(bestScore) > MATE_BOUND && d >= 2) break
        if (performance.now() - this.startTime > limits.timeMs * 0.55) break
      } catch (e) {
        if (!(e instanceof Abort)) throw e
        this.unwind(pos, basePly)
        break
      }
    }
    void us
    void list
    return {
      move: bestMove,
      score: bestScore,
      depth: doneDepth,
      nodes: this.nodes,
      timeMs: performance.now() - this.startTime,
    }
  }

  /**
   * Score every legal root move with a full window (no root cut-offs), iteratively deepening.
   * Used by the weakening logic. Returns the last fully completed iteration.
   */
  scoreRootMoves(pos: Position, limits: Limits, stop?: () => boolean): { scores: RootScore[]; depth: number } {
    this.begin(limits)
    this.stopFn = stop ?? null
    const basePly = pos.ply
    const root = pos.legalMoves()
    let result: RootScore[] = root.map((move) => ({ move, score: 0 }))
    let depthDone = 0
    for (let d = 1; d <= limits.maxDepth; d++) {
      try {
        const cur: RootScore[] = []
        for (const m of root) {
          pos.makeMove(m)
          const score = -this.negamax(pos, d - 1, -INF, INF, 1, true)
          pos.unmakeMove()
          cur.push({ move: m, score })
        }
        result = cur
        depthDone = d
        cur.sort((a, b) => b.score - a.score)
        root.length = 0
        for (const c of cur) root.push(c.move)
        if (performance.now() - this.startTime > limits.timeMs * 0.5) break
      } catch (e) {
        if (!(e instanceof Abort)) throw e
        this.unwind(pos, basePly)
        break
      }
    }
    return { scores: result, depth: depthDone }
  }

  get nodeCount(): number {
    return this.nodes
  }
}
