// Standard algebraic notation from a Position and an encoded move.
import { F_CASTLE, F_EP, K, N, P, Q, R, B, mFlags, mFrom, mPromo, mTo, sqName, type Position } from '../engine/board'

const LETTER: Record<number, string> = { [N]: 'N', [B]: 'B', [R]: 'R', [Q]: 'Q', [K]: 'K' }

/** SAN of legal move `m` in `pos`. Leaves `pos` unchanged. */
export function toSan(pos: Position, m: number): string {
  const from = mFrom(m)
  const to = mTo(m)
  const flags = mFlags(m)
  const type = pos.board[from]! & 7
  let s: string
  if (flags & F_CASTLE) {
    s = (to & 7) > (from & 7) ? 'O-O' : 'O-O-O'
  } else {
    const capture = pos.board[to] !== 0 || (flags & F_EP) !== 0
    if (type === P) {
      s = capture ? sqName(from)[0]! + 'x' : ''
      s += sqName(to)
      const pr = mPromo(m)
      if (pr) s += '=' + LETTER[pr]
    } else {
      s = LETTER[type]!
      let sameFile = false
      let sameRank = false
      let other = false
      for (const o of pos.legalMoves()) {
        if (o === m || mTo(o) !== to || mFrom(o) === from) continue
        if ((pos.board[mFrom(o)]! & 7) !== type) continue
        other = true
        if ((mFrom(o) & 7) === (from & 7)) sameFile = true
        if (mFrom(o) >> 4 === from >> 4) sameRank = true
      }
      if (other) {
        const name = sqName(from)
        if (!sameFile) s += name[0]
        else if (!sameRank) s += name[1]
        else s += name
      }
      if (capture) s += 'x'
      s += sqName(to)
    }
  }
  pos.makeMove(m)
  if (pos.inCheck()) s += pos.legalMoves().length === 0 ? '#' : '+'
  pos.unmakeMove()
  return s
}
