import { describe, expect, test } from 'vitest'
import { Chess } from 'chess.js'
import { Position, START_FEN, perft, mFlags, F_CAP } from '../src/engine/board'

const FENS = [
  START_FEN,
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1',
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  '4k3/8/8/8/8/8/8/4K2R w K - 12 40',
  'r3k3/8/8/8/8/8/8/R3K3 b Qq - 3 77',
  '8/P7/8/8/8/8/7p/K6k w - - 0 1',
  'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R b KQkq - 1 5',
  '2r3k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 30',
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  '8/8/8/3k4/8/3K4/8/8 b - - 99 120',
  'r2q1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 9',
  '6k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1',
  'rnbqkbnr/ppp1pppp/8/8/3pP3/5N2/PPPP1PPP/RNBQKB1R b KQkq e3 0 3',
  '1k6/8/8/8/8/8/8/K1B5 w - - 0 1',
]

function rng(seed: number) {
  let a = seed
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0
    return a / 4294967296
  }
}

describe('fen', () => {
  test('round trip on 20 positions', () => {
    expect(FENS.length).toBe(20)
    for (const f of FENS) expect(new Position(f).toFen()).toBe(f)
  })
})

describe('chess.js cross-check', () => {
  test('500 random playouts: legal moves match at every ply, hash stays incremental', () => {
    const r = rng(12345)
    for (let g = 0; g < 500; g++) {
      const ref = new Chess()
      const pos = new Position()
      for (let ply = 0; ply < 120; ply++) {
        const refMoves = ref.moves({ verbose: true })
        if (!refMoves.length) break
        const mine = pos.legalMoves().map((m) => pos.moveToUci(m)).sort()
        const theirs = refMoves.map((m) => m.from + m.to + (m.promotion ?? '')).sort()
        if (mine.join() !== theirs.join()) throw new Error('mismatch ' + ref.fen())
        const pick = refMoves[Math.floor(r() * refMoves.length)]!
        ref.move(pick)
        const mv = pos.parseUci(pick.from + pick.to + (pick.promotion ?? ''))
        if (mv < 0) throw new Error('unparsed ' + pick.san)
        pos.makeMove(mv)
        const lo = pos.hashLo
        const hi = pos.hashHi
        pos.computeHash()
        if (pos.hashLo !== lo || pos.hashHi !== hi) throw new Error('hash drift')
      }
      if (g % 50 === 0) expect(pos.toFen().split(' ').slice(0, 2)).toEqual(ref.fen().split(' ').slice(0, 2))
    }
  }, 400000)
})

describe('make/unmake', () => {
  test('unmake restores fen and hash', () => {
    for (const f of FENS) {
      const pos = new Position(f)
      const fen = pos.toFen()
      const lo = pos.hashLo
      for (const m of pos.legalMoves()) {
        pos.makeMove(m)
        pos.unmakeMove()
        expect(pos.toFen()).toBe(fen)
        expect(pos.hashLo).toBe(lo)
      }
    }
  })
  test('flags', () => {
    const pos = new Position('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1')
    const ep = pos.legalMoves().find((m) => pos.moveToUci(m) === 'e5d6')!
    expect(mFlags(ep) & F_CAP).toBe(F_CAP)
  })
})

describe('speed', () => {
  test('perft 5 from start under 3 s', () => {
    const pos = new Position()
    const t = performance.now()
    expect(perft(pos, 5)).toBe(4865609)
    expect(performance.now() - t).toBeLessThan(3000)
  })
})
