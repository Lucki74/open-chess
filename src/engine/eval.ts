// Static evaluation. Score is in centipawns from the side to move's point of view.
// Piece-square tables: the "Simplified Evaluation Function" by Tomasz Michniewski
// (Chess Programming Wiki), listed from rank 8 down to rank 1 as seen by White.
import { B, K, N, P, Position, Q, R, WHITE } from './board'

export const VALUE = [0, 100, 320, 330, 500, 900, 0]

const PST_P = [
  0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0,
  0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
]
const PST_N = [
  -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20,
  20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50,
  -40, -30, -30, -30, -30, -40, -50,
]
const PST_B = [
  -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5,
  5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10,
  -10, -10, -10, -10, -20,
]
const PST_R = [
  0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0,
  0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
]
const PST_Q = [
  -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
]
const PST_K_MG = [
  -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
]
const PST_K_EG = [
  -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30,
  -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0,
  0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50,
]

// Flatten into 0x88-indexed tables seen from White; Black reads the mirrored rank.
const mgTable: Int16Array[] = []
const egTable: Int16Array[] = []
for (let t = 0; t <= 6; t++) {
  mgTable.push(new Int16Array(128))
  egTable.push(new Int16Array(128))
}
function fill(t: number, mg: number[], eg: number[] = mg): void {
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const i = (7 - r) * 8 + f
      mgTable[t]![r * 16 + f] = mg[i]!
      egTable[t]![r * 16 + f] = eg[i]!
    }
}
fill(P, PST_P)
fill(N, PST_N)
fill(B, PST_B)
fill(R, PST_R)
fill(Q, PST_Q)
fill(K, PST_K_MG, PST_K_EG)

const PASSED_MG = [0, 5, 10, 18, 30, 50, 80, 0]
const PASSED_EG = [0, 10, 20, 35, 60, 100, 160, 0]
const PHASE_W = [0, 0, 1, 1, 2, 4, 0]
const BISHOP_PAIR = 30
const DOUBLED = 12
const ISOLATED = 14
const ROOK_OPEN = 20
const ROOK_SEMI = 10
const SHIELD_MISSING = 14
const MOB_W = [0, 0, 4, 3, 2, 1, 0]
const MOB_BASE = [0, 0, 4, 6, 6, 10, 0]
const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14]
const DIAG_D = [15, 17, -15, -17]
const ORTH_D = [1, -1, 16, -16]

// scratch arrays (single-threaded per worker)
const pawns = [new Int8Array(8), new Int8Array(8)]
const minRank = [new Int8Array(8), new Int8Array(8)] // lowest pawn rank per file (from own side's view: rank index 0..7)
const maxRank = [new Int8Array(8), new Int8Array(8)] // highest pawn rank
const rooks = [new Int8Array(8), new Int8Array(8)]

export function evaluate(pos: Position): number {
  if (pos.insufficientMaterial()) return 0
  const b = pos.board
  for (let c = 0; c < 2; c++) {
    pawns[c]!.fill(0)
    minRank[c]!.fill(7)
    maxRank[c]!.fill(0)
    rooks[c]!.fill(0)
  }
  let mg = 0
  let eg = 0
  let phase = 0
  let bishops0 = 0
  let bishops1 = 0
  let mat = 0

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f
      const p = b[sq]!
      if (!p) continue
      const t = p & 7
      const c = p >> 3
      if (t === P) {
        const rel = c === WHITE ? r : 7 - r
        pawns[c]![f]!++
        if (rel < minRank[c]![f]!) minRank[c]![f] = rel
        if (rel > maxRank[c]![f]!) maxRank[c]![f] = rel
      }
    }
  }

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f
      const p = b[sq]!
      if (!p) continue
      const t = p & 7
      const c = p >> 3
      const sign = c === WHITE ? 1 : -1
      const tsq = c === WHITE ? sq : (7 - r) * 16 + f
      const rel = c === WHITE ? r : 7 - r
      let m = VALUE[t]! + mgTable[t]![tsq]!
      let e = VALUE[t]! + egTable[t]![tsq]!
      phase += PHASE_W[t]!
      mat += VALUE[t]!

      if (t === P) {
        const them = c ^ 1
        // passed: no enemy pawn ahead on adjacent files (enemy rank measured from their side)
        let passed = true
        for (let df = -1; df <= 1 && passed; df++) {
          const ff = f + df
          if (ff < 0 || ff > 7) continue
          if (pawns[them]![ff]! > 0 && 7 - minRank[them]![ff]! > rel) passed = false
        }
        // enemy rel rank x corresponds to our-view rank 7-x; ahead means > rel
        if (passed) {
          m += PASSED_MG[rel]!
          e += PASSED_EG[rel]!
        }
        if (pawns[c]![f]! > 1) {
          m -= DOUBLED / 2
          e -= DOUBLED
        }
        const left = f > 0 ? pawns[c]![f - 1]! : 0
        const right = f < 7 ? pawns[c]![f + 1]! : 0
        if (!left && !right) {
          m -= ISOLATED
          e -= ISOLATED
        }
      } else if (t === R) {
        rooks[c]![f]!++
        if (!pawns[c]![f]!) {
          if (!pawns[c ^ 1]![f]!) m += ROOK_OPEN, (e += ROOK_OPEN / 2)
          else m += ROOK_SEMI, (e += ROOK_SEMI / 2)
        }
      } else if (t === B) {
        if (c === WHITE) bishops0++
        else bishops1++
      }

      // mobility (pseudo, own pieces block)
      if (t >= N && t <= Q) {
        let cnt = 0
        if (t === N) {
          for (let i = 0; i < 8; i++) {
            const s = sq + KNIGHT_D[i]!
            if (!(s & 0x88)) {
              const o = b[s]!
              if (!o || o >> 3 !== c) cnt++
            }
          }
        } else {
          const useDiag = t === B || t === Q
          const useOrth = t === R || t === Q
          if (useDiag)
            for (let i = 0; i < 4; i++) {
              const d = DIAG_D[i]!
              let s = sq + d
              while (!(s & 0x88)) {
                const o = b[s]!
                if (!o) cnt++
                else {
                  if (o >> 3 !== c) cnt++
                  break
                }
                s += d
              }
            }
          if (useOrth)
            for (let i = 0; i < 4; i++) {
              const d = ORTH_D[i]!
              let s = sq + d
              while (!(s & 0x88)) {
                const o = b[s]!
                if (!o) cnt++
                else {
                  if (o >> 3 !== c) cnt++
                  break
                }
                s += d
              }
            }
        }
        const mob = (cnt - MOB_BASE[t]!) * MOB_W[t]!
        m += mob
        e += mob
      }

      mg += sign * m
      eg += sign * e
    }
  }

  // bishop pair
  if (bishops0 >= 2) {
    mg += BISHOP_PAIR
    eg += BISHOP_PAIR + 10
  }
  if (bishops1 >= 2) {
    mg -= BISHOP_PAIR
    eg -= BISHOP_PAIR + 10
  }

  // king safety: pawn shield (middlegame only)
  for (let c = 0; c < 2; c++) {
    const ksq = pos.kingSq[c]!
    const kf = ksq & 7
    const kr = ksq >> 4
    const rel = c === WHITE ? kr : 7 - kr
    if (rel > 1) continue
    const dir = c === WHITE ? 16 : -16
    let missing = 0
    for (let df = -1; df <= 1; df++) {
      const ff = kf + df
      if (ff < 0 || ff > 7) continue
      const s1 = ksq + dir + df
      const s2 = s1 + dir
      const own = P | (c << 3)
      if (b[s1] !== own && ((s2 & 0x88) !== 0 || b[s2] !== own)) missing++
    }
    mg += (c === WHITE ? -1 : 1) * missing * SHIELD_MISSING
  }

  const ph = Math.min(24, phase)
  const score = Math.trunc((mg * ph + eg * (24 - ph)) / 24)
  return pos.side === WHITE ? score : -score
}
