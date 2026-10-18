// Pure game state: no DOM, no engine. The controller drives it.
import { BLACK, START_FEN, WHITE, Position, mFrom, mTo, sqName } from '../engine/board'
import { toSan } from './san'

export type Side = 'w' | 'b'
export type Termination = 'checkmate' | 'stalemate' | 'threefold' | 'fifty' | 'insufficient' | 'resign'
export interface Outcome {
  termination: Termination
  /** null for a draw */
  winner: Side | null
}

const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 }
export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const TYPES = ['', 'p', 'n', 'b', 'r', 'q', 'k']

export class GameState {
  readonly fenStart: string
  pos: Position
  uci: string[] = []
  san: string[] = []
  /** [from,to] algebraic per ply, for last-move highlight */
  squares: [string, string][] = []

  constructor(fenStart: string = START_FEN, uci: string[] = []) {
    this.fenStart = fenStart
    this.pos = new Position(fenStart)
    for (const u of uci) if (!this.play(u)) throw new Error('bad move in saved game: ' + u)
  }

  get turn(): Side {
    return this.pos.side === WHITE ? 'w' : 'b'
  }

  get plies(): number {
    return this.uci.length
  }

  legalMoves(): number[] {
    return this.pos.legalMoves()
  }

  /** Play a UCI move. Returns false when illegal. */
  play(u: string): boolean {
    const m = this.pos.parseUci(u)
    if (m < 0) return false
    this.san.push(toSan(this.pos, m))
    this.uci.push(u)
    this.squares.push([sqName(mFrom(m)), sqName(mTo(m))])
    this.pos.makeMove(m)
    return true
  }

  /** Remove the last n plies by rebuilding from the start. */
  undo(n: number): void {
    const keep = this.uci.slice(0, Math.max(0, this.uci.length - n))
    const g = new GameState(this.fenStart, keep)
    this.pos = g.pos
    this.uci = g.uci
    this.san = g.san
    this.squares = g.squares
  }

  inCheck(): boolean {
    return this.pos.inCheck()
  }

  outcome(): Outcome | null {
    const p = this.pos
    if (p.legalMoves().length === 0) {
      return p.inCheck() ? { termination: 'checkmate', winner: p.side === WHITE ? 'b' : 'w' } : { termination: 'stalemate', winner: null }
    }
    if (p.repetitions() >= 3) return { termination: 'threefold', winner: null }
    if (p.halfmove >= 100) return { termination: 'fifty', winner: null }
    if (p.insufficientMaterial()) return { termination: 'insufficient', winner: null }
    return null
  }

  /** Square of the king in check (for the pulse), or null. */
  checkedKing(): string | null {
    return this.pos.inCheck() ? sqName(this.pos.kingSq[this.pos.side]!) : null
  }
}

/** Position after the first n plies of a game. */
export function positionAt(fenStart: string, uci: string[], n: number): { pos: Position; last: [string, string] | null } {
  const pos = new Position(fenStart)
  let last: [string, string] | null = null
  for (let i = 0; i < n; i++) {
    const m = pos.parseUci(uci[i]!)
    if (m < 0) break
    last = [sqName(mFrom(m)), sqName(mTo(m))]
    pos.makeMove(m)
  }
  return { pos, last }
}

/** Pieces captured by each side, derived from what is missing from the board. */
export function captured(pos: Position): { byWhite: string[]; byBlack: string[]; diff: number } {
  const have: Record<string, number>[] = [{}, {}]
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const p = pos.board[r * 16 + f]!
      if (!p) continue
      const t = TYPES[p & 7]!
      const side = p >> 3
      have[side]![t] = (have[side]![t] ?? 0) + 1
    }
  const missing = (side: number): string[] => {
    const out: string[] = []
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const n = START_COUNT[t]! - (have[side]![t] ?? 0)
      for (let i = 0; i < n; i++) out.push(t)
    }
    return out
  }
  const byWhite = missing(BLACK)
  const byBlack = missing(WHITE)
  const sum = (a: string[]): number => a.reduce((s, t) => s + PIECE_VALUE[t]!, 0)
  return { byWhite, byBlack, diff: sum(byWhite) - sum(byBlack) }
}
