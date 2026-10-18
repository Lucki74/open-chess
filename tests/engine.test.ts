import { describe, expect, test } from 'vitest'
import { Position, START_FEN } from '../src/engine/board'
import { evaluate } from '../src/engine/eval'
import { MATE, Searcher } from '../src/engine/search'
import { BOOK_LINES } from '../src/engine/book'
import { botMover, fixedDepthMover, playGame, rngFrom } from '../src/engine/match'
import { Bot } from '../src/engine/bot'
import { levelFor } from '../src/engine/levels'

function mirrorFen(fen: string): string {
  const [pieces, side, castle, ep, half, full] = fen.split(' ')
  const rows = pieces!.split('/').reverse().map((r) => [...r].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join(''))
  const c = castle === '-' ? '-' : [...castle!].map((x) => (x === x.toLowerCase() ? x.toUpperCase() : x.toLowerCase())).sort((a, b) => 'KQkq'.indexOf(a) - 'KQkq'.indexOf(b)).join('')
  const e = ep === '-' ? '-' : ep![0]! + (ep![1] === '3' ? '6' : '3')
  return `${rows.join('/')} ${side === 'w' ? 'b' : 'w'} ${c} ${e} ${half} ${full}`
}

describe('evaluation', () => {
  test('symmetric over 100 positions', () => {
    const rnd = rngFrom(7)
    let checked = 0
    while (checked < 100) {
      const pos = new Position()
      const n = 4 + Math.floor(rnd() * 70)
      for (let i = 0; i < n; i++) {
        const mv = pos.legalMoves()
        if (!mv.length) break
        pos.makeMove(mv[Math.floor(rnd() * mv.length)]!)
      }
      const fen = pos.toFen()
      const a = evaluate(pos)
      const b = evaluate(new Position(mirrorFen(fen)))
      expect(b, fen).toBe(a)
      checked++
    }
  })
  test('draw by insufficient material is 0', () => {
    expect(evaluate(new Position('8/8/4k3/8/8/3K4/8/6B1 w - - 0 1'))).toBe(0)
    expect(evaluate(new Position('8/8/4k3/8/8/3K4/8/6N1 b - - 0 1'))).toBe(0)
  })
  test('material counts', () => {
    expect(evaluate(new Position(START_FEN))).toBe(0)
    expect(evaluate(new Position('4k3/8/8/8/8/8/8/3QK3 w - - 0 1'))).toBeGreaterThan(800)
  })
})

const FULL = { maxDepth: 6, maxNodes: 3e6, timeMs: 8000, qDepth: 12, nullMove: true, lmr: true }

const MATE_IN_1: [string, string[]][] = [
  ['6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ['a1a8']],
  ['r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', ['h5f7']],
  ['3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', ['d1d8']],
  ['6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', ['g5f7']],
  ['k7/8/1K6/8/8/8/8/7R w - - 0 1', ['h1h8']],
  ['7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', ['g1g7']],
  ['6k1/8/8/8/8/6q1/r7/7K b - - 0 1', ['a2a1', 'a2h2', 'g3g2']],
  ['k7/8/1K6/8/8/8/8/6Q1 w - - 0 1', ['g1a7', 'g1g8']],
]
const MATE_IN_2 = [
  '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1',
  'k7/2K5/8/8/8/8/8/1R6 w - - 0 1',
]
const WINS: [string, string[]][] = [
  ['4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', ['d1d5']],
  ['rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3', ['f3h4']],
  ['8/4P1k1/8/8/8/8/8/K7 w - - 0 1', ['e7e8q', 'e7e8r']],
]

describe('search puzzles at full strength', () => {
  const s = new Searcher(18)
  test.each(MATE_IN_1)('mate in 1: %s', (fen, expected) => {
    const pos = new Position(fen)
    const r = s.search(pos, FULL)
    expect(expected).toContain(pos.moveToUci(r.move))
    expect(r.score).toBeGreaterThan(MATE - 5)
  })
  test.each(MATE_IN_2)('mate in 2: %s', (fen) => {
    const pos = new Position(fen)
    const r = s.search(pos, FULL)
    expect(r.score).toBeGreaterThan(MATE - 6)
  })
  test.each(WINS)('wins material: %s', (fen, expected) => {
    const pos = new Position(fen)
    const r = s.search(pos, FULL)
    expect(expected).toContain(pos.moveToUci(r.move))
  })
  test('search leaves the position untouched even when aborted', () => {
    const pos = new Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
    const fen = pos.toFen()
    const hash = pos.hashLo
    for (const maxNodes of [300, 1000, 2500, 5000, 9000, 20000]) {
      s.search(pos, { ...FULL, maxNodes, maxDepth: 12 })
      expect(pos.toFen(), `nodes ${maxNodes}`).toBe(fen)
      expect(pos.hashLo, `hash at ${maxNodes}`).toBe(hash)
      expect(pos.ply).toBe(0)
    }
  })
})

describe('book', () => {
  test('every book line is legal', () => {
    expect(BOOK_LINES.length).toBeGreaterThanOrEqual(30)
    expect(BOOK_LINES.length).toBeLessThanOrEqual(60)
    for (const line of BOOK_LINES) {
      const pos = new Position()
      for (const u of line) {
        const m = pos.parseUci(u)
        expect(m, line.join(' ')).toBeGreaterThan(-1)
        pos.makeMove(m)
      }
    }
  })
})

describe('self-play sanity', () => {
  test('depth-4 engine beats a depth-2 copy in 20 of 20 games', () => {
    const rnd = rngFrom(99)
    const strong = fixedDepthMover(4)
    const weak = fixedDepthMover(2)
    let wins = 0
    for (let g = 0; g < 20; g++) {
      const strongWhite = g % 2 === 0
      const o = playGame(strongWhite ? strong : weak, strongWhite ? weak : strong, { openingPlies: 4, rng: rnd, maxPlies: 400 })
      if (o.result === (strongWhite ? 1 : -1)) wins++
    }
    expect(wins).toBe(20)
  }, 900000)
})

describe('bot levers', () => {
  test('null move and LMR switch on at skill 50 and 40', () => {
    expect(levelFor(10).nullMove).toBe(false)
    expect(levelFor(49).nullMove).toBe(false)
    expect(levelFor(50).nullMove).toBe(true)
    expect(levelFor(39).lmr).toBe(false)
    expect(levelFor(40).lmr).toBe(true)
  })
  test('depth, nodes, quiescence and book use rise with skill', () => {
    for (const k of ['depth', 'nodes', 'qDepth', 'book'] as const)
      for (let s = 0; s < 100; s++) expect(levelFor(s + 1)[k], `${k} at ${s + 1}`).toBeGreaterThanOrEqual(levelFor(s)[k])
    expect(levelFor(0).depth).toBe(0)
    expect(levelFor(100).depth).toBeGreaterThanOrEqual(7)
  })
  test('quiescence is off at the lowest levels', () => {
    expect(levelFor(0).qDepth).toBe(0)
    expect(levelFor(10).qDepth).toBe(0)
  })
  test('noise, blunder, blind and spread fall to zero at the top', () => {
    expect(levelFor(100)).toMatchObject({ noise: 0, blunder: 0, blind: 0, spread: 0, topK: 1 })
    expect(levelFor(0).noise).toBeGreaterThan(0)
    expect(levelFor(0).blunder).toBeGreaterThan(0)
    expect(levelFor(0).blind).toBeGreaterThan(0)
  })
  test('think time and search time stay under the 2.5 s cap', () => {
    for (let s = 0; s <= 100; s++) {
      const l = levelFor(s)
      expect(l.timeMs).toBeLessThanOrEqual(2300)
      expect(l.thinkMax).toBeLessThanOrEqual(1200)
      expect(l.thinkMin).toBeLessThanOrEqual(l.thinkMax)
    }
  })
  test('node limit caps a search', () => {
    const s = new Searcher(16)
    const pos = new Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
    s.search(pos, { maxDepth: 12, maxNodes: 5000, timeMs: 5000, qDepth: 8, nullMove: true, lmr: true })
    expect(s.nodeCount).toBeLessThanOrEqual(5000 + 500)
  })
  test('one-move mate is never missed above skill 40', () => {
    const pos = new Position('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1')
    const bot = new Bot(16)
    for (let i = 0; i < 40; i++) {
      const r = bot.choose(pos, 45, { rng: rngFrom(i + 1), timeCapMs: 200 })
      expect(pos.moveToUci(r!.move)).toBe('a1a8')
    }
  })
  test('a hanging queen is never left en prise at skill 30', () => {
    const pos = new Position('4k3/8/8/4p3/3Q4/8/8/4K3 w - - 0 1')
    const bot = new Bot(16)
    for (let i = 0; i < 100; i++) {
      const r = bot.choose(pos, 30, { rng: rngFrom(i + 1), timeCapMs: 200 })
      expect(pos.moveToUci(r!.move).startsWith('d4'), `seed ${i}`).toBe(true)
    }
  })
})

describe('search draw rules', () => {
  test('fifty-move counter scores as a draw inside search', () => {
    const s = new Searcher(16)
    const lim = { maxDepth: 3, maxNodes: 1e6, timeMs: 5000, qDepth: 4, nullMove: false, lmr: false }
    const live = s.search(new Position('4k3/8/8/8/8/8/8/3QK3 w - - 0 1'), lim)
    expect(live.score).toBeGreaterThan(500)
    const dead = s.search(new Position('4k3/8/8/8/8/8/8/3QK3 w - - 100 80'), lim)
    expect(Math.abs(dead.score)).toBeLessThan(100)
  })
  test('a move that repeats a position is scored as a draw', () => {
    const s = new Searcher(16)
    const pos = new Position('4k3/8/8/8/8/8/8/3QK3 w - - 0 1')
    for (const u of ['d1d2', 'e8e7', 'd2d1', 'e7e8']) pos.makeMove(pos.parseUci(u))
    const { scores } = s.scoreRootMoves(pos, { maxDepth: 1, maxNodes: 1e6, timeMs: 5000, qDepth: 0, nullMove: false, lmr: false })
    const rep = scores.find((x) => pos.moveToUci(x.move) === 'd1d2')!
    expect(Math.abs(rep.score)).toBe(0)
    expect(Math.max(...scores.map((x) => x.score))).toBeGreaterThan(300)
  })
})

describe('skill monotonicity', () => {
  test('a skill 20 points higher never loses a 30-game match', () => {
    const pairs: [number, number][] = [
      [20, 0],
      [40, 20],
      [60, 40],
      [80, 60],
      [100, 80],
    ]
    for (const [hi, lo] of pairs) {
      const rnd = rngFrom(hi * 131 + lo)
      const high = botMover(hi, rnd, 10, new Bot(16))
      const low = botMover(lo, rnd, 10, new Bot(16))
      let score = 0
      for (let g = 0; g < 30; g++) {
        const hiWhite = g % 2 === 0
        const o = playGame(hiWhite ? high : low, hiWhite ? low : high, { openingPlies: 4, rng: rnd, maxPlies: 160 })
        score += o.result === 0 ? 0.5 : (o.result === 1) === hiWhite ? 1 : 0
      }
      expect(score, `${hi} vs ${lo}`).toBeGreaterThanOrEqual(15)
    }
  }, 900000)
})
