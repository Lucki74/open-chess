// 0x88 board, move generation, make/unmake and Zobrist hashing.
// Piece code = type | (colour << 3). Squares: rank * 16 + file, rank 0 is white's first rank.

export const EMPTY = 0
export const P = 1
export const N = 2
export const B = 3
export const R = 4
export const Q = 5
export const K = 6
export const WHITE = 0
export const BLACK = 1

export const CASTLE_WK = 1
export const CASTLE_WQ = 2
export const CASTLE_BK = 4
export const CASTLE_BQ = 8

export const F_CAP = 1
export const F_EP = 2
export const F_CASTLE = 4
export const F_DBL = 8

export const mFrom = (m: number): number => m & 127
export const mTo = (m: number): number => (m >> 7) & 127
export const mPromo = (m: number): number => (m >> 14) & 7
export const mFlags = (m: number): number => m >> 17
export const mk = (from: number, to: number, promo: number, flags: number): number =>
  from | (to << 7) | (promo << 14) | (flags << 17)

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14]
const BISHOP_D = [15, 17, -15, -17]
const ROOK_D = [1, -1, 16, -16]
const KING_D = [1, -1, 16, -16, 15, 17, -15, -17]

const CASTLE_MASK = new Uint8Array(128).fill(15)
CASTLE_MASK[0x04] = 15 & ~(CASTLE_WK | CASTLE_WQ)
CASTLE_MASK[0x00] = 15 & ~CASTLE_WQ
CASTLE_MASK[0x07] = 15 & ~CASTLE_WK
CASTLE_MASK[0x74] = 15 & ~(CASTLE_BK | CASTLE_BQ)
CASTLE_MASK[0x70] = 15 & ~CASTLE_BQ
CASTLE_MASK[0x77] = 15 & ~CASTLE_BK

// Deterministic Zobrist keys (two 32-bit halves).
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) | 0
  }
}
const rnd = mulberry32(0xc0ffee)
export const ZP_LO = new Int32Array(16 * 128)
export const ZP_HI = new Int32Array(16 * 128)
for (let i = 0; i < ZP_LO.length; i++) {
  ZP_LO[i] = rnd()
  ZP_HI[i] = rnd()
}
const ZC_LO = new Int32Array(16)
const ZC_HI = new Int32Array(16)
for (let i = 0; i < 16; i++) {
  ZC_LO[i] = rnd()
  ZC_HI[i] = rnd()
}
const ZE_LO = new Int32Array(8)
const ZE_HI = new Int32Array(8)
for (let i = 0; i < 8; i++) {
  ZE_LO[i] = rnd()
  ZE_HI[i] = rnd()
}
const ZS_LO = rnd()
const ZS_HI = rnd()

const MAX_PLY = 2048
const PIECE_CHARS = '.PNBRQK'

export const sqName = (sq: number): string => 'abcdefgh'[sq & 7]! + ((sq >> 4) + 1)
export const sqFromName = (s: string): number => (s.charCodeAt(0) - 97) + (s.charCodeAt(1) - 49) * 16

export class Position {
  board = new Int8Array(128)
  side = WHITE
  castling = 0
  ep = -1
  halfmove = 0
  fullmove = 1
  kingSq = [0, 0]
  hashLo = 0
  hashHi = 0
  ply = 0
  // history stacks (preallocated)
  private hMove = new Int32Array(MAX_PLY)
  private hCapt = new Int8Array(MAX_PLY)
  private hCastle = new Uint8Array(MAX_PLY)
  private hEp = new Int16Array(MAX_PLY)
  private hHalf = new Int16Array(MAX_PLY)
  hLo = new Int32Array(MAX_PLY + 1)
  hHi = new Int32Array(MAX_PLY + 1)

  constructor(fen: string = START_FEN) {
    this.loadFen(fen)
  }

  loadFen(fen: string): void {
    const parts = fen.trim().split(/\s+/)
    this.board.fill(0)
    const rows = (parts[0] ?? '').split('/')
    if (rows.length !== 8) throw new Error('bad fen: ' + fen)
    for (let r = 0; r < 8; r++) {
      const row = rows[7 - r]!
      let f = 0
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') f += ch.charCodeAt(0) - 48
        else {
          const lower = ch.toLowerCase()
          const t = 'pnbrqk'.indexOf(lower) + 1
          if (t === 0 || f > 7) throw new Error('bad fen: ' + fen)
          const color = ch === lower ? BLACK : WHITE
          const sq = r * 16 + f
          this.board[sq] = t | (color << 3)
          if (t === K) this.kingSq[color] = sq
          f++
        }
      }
    }
    this.side = parts[1] === 'b' ? BLACK : WHITE
    const c = parts[2] ?? '-'
    this.castling =
      (c.includes('K') ? CASTLE_WK : 0) |
      (c.includes('Q') ? CASTLE_WQ : 0) |
      (c.includes('k') ? CASTLE_BK : 0) |
      (c.includes('q') ? CASTLE_BQ : 0)
    const e = parts[3] ?? '-'
    this.ep = e === '-' ? -1 : sqFromName(e)
    this.halfmove = parseInt(parts[4] ?? '0', 10) || 0
    this.fullmove = parseInt(parts[5] ?? '1', 10) || 1
    this.ply = 0
    this.computeHash()
    this.hLo[0] = this.hashLo
    this.hHi[0] = this.hashHi
  }

  toFen(): string {
    let s = ''
    for (let r = 7; r >= 0; r--) {
      let empty = 0
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 16 + f]!
        if (!p) empty++
        else {
          if (empty) {
            s += empty
            empty = 0
          }
          const ch = PIECE_CHARS[p & 7]!
          s += p >> 3 ? ch.toLowerCase() : ch
        }
      }
      if (empty) s += empty
      if (r) s += '/'
    }
    let c = ''
    if (this.castling & CASTLE_WK) c += 'K'
    if (this.castling & CASTLE_WQ) c += 'Q'
    if (this.castling & CASTLE_BK) c += 'k'
    if (this.castling & CASTLE_BQ) c += 'q'
    return `${s} ${this.side ? 'b' : 'w'} ${c || '-'} ${this.ep < 0 ? '-' : sqName(this.ep)} ${this.halfmove} ${this.fullmove}`
  }

  computeHash(): void {
    let lo = 0
    let hi = 0
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) {
        const sq = r * 16 + f
        const p = this.board[sq]!
        if (p) {
          lo ^= ZP_LO[p * 128 + sq]!
          hi ^= ZP_HI[p * 128 + sq]!
        }
      }
    lo ^= ZC_LO[this.castling]!
    hi ^= ZC_HI[this.castling]!
    if (this.ep >= 0) {
      lo ^= ZE_LO[this.ep & 7]!
      hi ^= ZE_HI[this.ep & 7]!
    }
    if (this.side) {
      lo ^= ZS_LO
      hi ^= ZS_HI
    }
    this.hashLo = lo
    this.hashHi = hi
  }

  isAttacked(sq: number, by: number): boolean {
    const b = this.board
    // pawns
    if (by === WHITE) {
      let s = sq - 15
      if (!(s & 0x88) && b[s] === P) return true
      s = sq - 17
      if (!(s & 0x88) && b[s] === P) return true
    } else {
      let s = sq + 15
      if (!(s & 0x88) && b[s] === (P | 8)) return true
      s = sq + 17
      if (!(s & 0x88) && b[s] === (P | 8)) return true
    }
    const c8 = by << 3
    const kn = N | c8
    for (let i = 0; i < 8; i++) {
      const s = sq + KNIGHT_D[i]!
      if (!(s & 0x88) && b[s] === kn) return true
    }
    const kg = K | c8
    for (let i = 0; i < 8; i++) {
      const s = sq + KING_D[i]!
      if (!(s & 0x88) && b[s] === kg) return true
    }
    const bi = B | c8
    const qu = Q | c8
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_D[i]!
      let s = sq + d
      while (!(s & 0x88)) {
        const p = b[s]!
        if (p) {
          if (p === bi || p === qu) return true
          break
        }
        s += d
      }
    }
    const ro = R | c8
    for (let i = 0; i < 4; i++) {
      const d = ROOK_D[i]!
      let s = sq + d
      while (!(s & 0x88)) {
        const p = b[s]!
        if (p) {
          if (p === ro || p === qu) return true
          break
        }
        s += d
      }
    }
    return false
  }

  inCheck(): boolean {
    return this.isAttacked(this.kingSq[this.side]!, this.side ^ 1)
  }

  /** Pseudo-legal moves into `list`; returns count. captures-only includes promotions. */
  generate(list: Int32Array, capsOnly = false): number {
    let n = 0
    const us = this.side
    const them = us ^ 1
    const b = this.board
    const fwd = us === WHITE ? 16 : -16
    const startRank = us === WHITE ? 1 : 6
    const promoRank = us === WHITE ? 6 : 1
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = r * 16 + f
        const p = b[sq]!
        if (!p || p >> 3 !== us) continue
        const t = p & 7
        if (t === P) {
          const one = sq + fwd
          if (r === promoRank) {
            if (!b[one]) {
              list[n++] = mk(sq, one, Q, 0)
              if (!capsOnly) {
                list[n++] = mk(sq, one, N, 0)
                list[n++] = mk(sq, one, R, 0)
                list[n++] = mk(sq, one, B, 0)
              }
            }
          } else if (!b[one] && !capsOnly) {
            list[n++] = mk(sq, one, 0, 0)
            if (r === startRank && !b[one + fwd]) list[n++] = mk(sq, one + fwd, 0, F_DBL)
          }
          for (let k = -1; k <= 1; k += 2) {
            const to = one + k
            if (to & 0x88) continue
            const cp = b[to]!
            if (cp && cp >> 3 === them) {
              if (r === promoRank) {
                list[n++] = mk(sq, to, Q, F_CAP)
                list[n++] = mk(sq, to, R, F_CAP)
                list[n++] = mk(sq, to, B, F_CAP)
                list[n++] = mk(sq, to, N, F_CAP)
              } else list[n++] = mk(sq, to, 0, F_CAP)
            } else if (to === this.ep && !cp) {
              list[n++] = mk(sq, to, 0, F_CAP | F_EP)
            }
          }
        } else if (t === N || t === K) {
          const dirs = t === N ? KNIGHT_D : KING_D
          for (let i = 0; i < 8; i++) {
            const to = sq + dirs[i]!
            if (to & 0x88) continue
            const cp = b[to]!
            if (!cp) {
              if (!capsOnly) list[n++] = mk(sq, to, 0, 0)
            } else if (cp >> 3 === them) list[n++] = mk(sq, to, 0, F_CAP)
          }
          if (t === K && !capsOnly) {
            const home = us === WHITE ? 0x04 : 0x74
            if (sq === home && !this.isAttacked(sq, them)) {
              const ks = us === WHITE ? CASTLE_WK : CASTLE_BK
              const qs = us === WHITE ? CASTLE_WQ : CASTLE_BQ
              if (
                this.castling & ks &&
                !b[sq + 1] &&
                !b[sq + 2] &&
                b[sq + 3] === (R | (us << 3)) &&
                !this.isAttacked(sq + 1, them)
              )
                list[n++] = mk(sq, sq + 2, 0, F_CASTLE)
              if (
                this.castling & qs &&
                !b[sq - 1] &&
                !b[sq - 2] &&
                !b[sq - 3] &&
                b[sq - 4] === (R | (us << 3)) &&
                !this.isAttacked(sq - 1, them)
              )
                list[n++] = mk(sq, sq - 2, 0, F_CASTLE)
            }
          }
        } else {
          const dirs = t === B ? BISHOP_D : t === R ? ROOK_D : KING_D
          const nd = t === Q ? 8 : 4
          for (let i = 0; i < nd; i++) {
            const d = dirs[i]!
            let to = sq + d
            while (!(to & 0x88)) {
              const cp = b[to]!
              if (!cp) {
                if (!capsOnly) list[n++] = mk(sq, to, 0, 0)
              } else {
                if (cp >> 3 === them) list[n++] = mk(sq, to, 0, F_CAP)
                break
              }
              to += d
            }
          }
        }
      }
    }
    return n
  }

  makeMove(m: number): void {
    const from = m & 127
    const to = (m >> 7) & 127
    const promo = (m >> 14) & 7
    const flags = m >> 17
    const b = this.board
    const us = this.side
    const piece = b[from]!
    let captured = b[to]!
    const i = this.ply
    this.hMove[i] = m
    this.hCapt[i] = captured
    this.hCastle[i] = this.castling
    this.hEp[i] = this.ep
    this.hHalf[i] = this.halfmove

    let lo = this.hashLo
    let hi = this.hashHi
    lo ^= ZC_LO[this.castling]!
    hi ^= ZC_HI[this.castling]!
    if (this.ep >= 0) {
      lo ^= ZE_LO[this.ep & 7]!
      hi ^= ZE_HI[this.ep & 7]!
    }
    lo ^= ZP_LO[piece * 128 + from]!
    hi ^= ZP_HI[piece * 128 + from]!
    b[from] = 0

    if (flags & F_EP) {
      const csq = to - (us === WHITE ? 16 : -16)
      captured = b[csq]!
      this.hCapt[i] = captured
      lo ^= ZP_LO[captured * 128 + csq]!
      hi ^= ZP_HI[captured * 128 + csq]!
      b[csq] = 0
    } else if (captured) {
      lo ^= ZP_LO[captured * 128 + to]!
      hi ^= ZP_HI[captured * 128 + to]!
    }
    const placed = promo ? promo | (us << 3) : piece
    b[to] = placed
    lo ^= ZP_LO[placed * 128 + to]!
    hi ^= ZP_HI[placed * 128 + to]!

    if ((piece & 7) === K) this.kingSq[us] = to
    if (flags & F_CASTLE) {
      let rf: number
      let rt: number
      if (to > from) {
        rf = from + 3
        rt = from + 1
      } else {
        rf = from - 4
        rt = from - 1
      }
      const rook = b[rf]!
      b[rf] = 0
      b[rt] = rook
      lo ^= ZP_LO[rook * 128 + rf]! ^ ZP_LO[rook * 128 + rt]!
      hi ^= ZP_HI[rook * 128 + rf]! ^ ZP_HI[rook * 128 + rt]!
    }

    this.castling &= CASTLE_MASK[from]! & CASTLE_MASK[to]!
    this.ep = flags & F_DBL ? (from + to) >> 1 : -1
    if ((piece & 7) === P || captured) this.halfmove = 0
    else this.halfmove++
    if (us === BLACK) this.fullmove++

    lo ^= ZC_LO[this.castling]!
    hi ^= ZC_HI[this.castling]!
    if (this.ep >= 0) {
      lo ^= ZE_LO[this.ep & 7]!
      hi ^= ZE_HI[this.ep & 7]!
    }
    lo ^= ZS_LO
    hi ^= ZS_HI
    this.hashLo = lo
    this.hashHi = hi
    this.side = us ^ 1
    this.ply = i + 1
    this.hLo[i + 1] = lo
    this.hHi[i + 1] = hi
  }

  unmakeMove(): void {
    const i = --this.ply
    const m = this.hMove[i]!
    const from = m & 127
    const to = (m >> 7) & 127
    const promo = (m >> 14) & 7
    const flags = m >> 17
    const b = this.board
    this.side ^= 1
    const us = this.side
    const captured = this.hCapt[i]!
    const placed = b[to]!
    const piece = promo ? P | (us << 3) : placed
    b[from] = piece
    if (flags & F_EP) {
      b[to] = 0
      b[to - (us === WHITE ? 16 : -16)] = captured
    } else b[to] = captured
    if ((piece & 7) === K) this.kingSq[us] = from
    if (flags & F_CASTLE) {
      let rf: number
      let rt: number
      if (to > from) {
        rf = from + 3
        rt = from + 1
      } else {
        rf = from - 4
        rt = from - 1
      }
      b[rf] = b[rt]!
      b[rt] = 0
    }
    this.castling = this.hCastle[i]!
    this.ep = this.hEp[i]!
    this.halfmove = this.hHalf[i]!
    if (us === BLACK) this.fullmove--
    this.hashLo = this.hLo[i]!
    this.hashHi = this.hHi[i]!
  }

  makeNull(): void {
    const i = this.ply
    this.hMove[i] = 0
    this.hCapt[i] = 0
    this.hCastle[i] = this.castling
    this.hEp[i] = this.ep
    this.hHalf[i] = this.halfmove
    let lo = this.hashLo
    let hi = this.hashHi
    if (this.ep >= 0) {
      lo ^= ZE_LO[this.ep & 7]!
      hi ^= ZE_HI[this.ep & 7]!
    }
    this.ep = -1
    lo ^= ZS_LO
    hi ^= ZS_HI
    this.hashLo = lo
    this.hashHi = hi
    this.side ^= 1
    this.halfmove++
    this.ply = i + 1
    this.hLo[i + 1] = lo
    this.hHi[i + 1] = hi
  }

  unmakeNull(): void {
    const i = --this.ply
    this.side ^= 1
    this.ep = this.hEp[i]!
    this.halfmove = this.hHalf[i]!
    this.hashLo = this.hLo[i]!
    this.hashHi = this.hHi[i]!
  }

  /** Unmake back to `ply`, using unmakeNull for null-move entries (stored as move 0). */
  unwindTo(ply: number): void {
    while (this.ply > ply) {
      if (this.hMove[this.ply - 1] === 0) this.unmakeNull()
      else this.unmakeMove()
    }
  }

  /** Make `m` if legal; returns false (and leaves position unchanged) otherwise. */
  makeLegal(m: number): boolean {
    const us = this.side
    this.makeMove(m)
    if (this.isAttacked(this.kingSq[us]!, us ^ 1)) {
      this.unmakeMove()
      return false
    }
    return true
  }

  legalMoves(): number[] {
    const list = new Int32Array(256)
    const n = this.generate(list)
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      if (this.makeLegal(list[i]!)) {
        this.unmakeMove()
        out.push(list[i]!)
      }
    }
    return out
  }

  /** Repetition count of the current position within the reversible window (including current). */
  repetitions(): number {
    let c = 1
    const lim = Math.max(0, this.ply - this.halfmove)
    for (let i = this.ply - 2; i >= lim; i -= 2) {
      if (this.hLo[i] === this.hashLo && this.hHi[i] === this.hashHi) c++
    }
    return c
  }

  insufficientMaterial(): boolean {
    let minors = 0
    let bishopsLight = 0
    let bishopsDark = 0
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) {
        const t = this.board[r * 16 + f]! & 7
        if (!t || t === K) continue
        if (t === P || t === R || t === Q) return false
        minors++
        if (t === B) {
          if ((r + f) & 1) bishopsLight++
          else bishopsDark++
        }
      }
    if (minors <= 1) return true
    // only bishops, all on the same colour
    return minors === bishopsLight + bishopsDark && (bishopsLight === 0 || bishopsDark === 0)
  }

  moveToUci(m: number): string {
    const p = mPromo(m)
    return sqName(mFrom(m)) + sqName(mTo(m)) + (p ? 'nbrq'[p - 2] ?? '' : '')
  }

  /** Find the legal move matching a UCI string, or -1. */
  parseUci(uci: string): number {
    const from = sqFromName(uci.slice(0, 2))
    const to = sqFromName(uci.slice(2, 4))
    const pc = uci[4]
    const promo = pc ? 'pnbrqk'.indexOf(pc) + 1 : 0
    for (const m of this.legalMoves()) {
      if (mFrom(m) === from && mTo(m) === to && mPromo(m) === promo) return m
    }
    return -1
  }
}

const perftLists: Int32Array[] = []
export function perft(pos: Position, depth: number): number {
  const list = (perftLists[depth] ??= new Int32Array(256))
  const n = pos.generate(list)
  let count = 0
  const us = pos.side
  for (let i = 0; i < n; i++) {
    pos.makeMove(list[i]!)
    if (!pos.isAttacked(pos.kingSq[us]!, us ^ 1)) {
      count += depth === 1 ? 1 : perft(pos, depth - 1)
    }
    pos.unmakeMove()
  }
  return count
}
