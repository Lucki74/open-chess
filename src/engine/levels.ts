// Skill (0..100) to engine levers. Eleven anchor rows, linear interpolation in between.
// The anchor values were tuned with tools/selfplay.ts; see docs/calibration.md.
export interface Level {
  skill: number
  /** 0 means "random mover with capture bias" */
  depth: number
  nodes: number
  /** quiescence depth, 0 = off */
  qDepth: number
  /** random +/- centipawns added to each root move score */
  noise: number
  /** choose among this many best moves */
  topK: number
  /** only moves within this many cp of the best are candidates */
  spread: number
  /** probability per move of a clearly worse move */
  blunder: number
  /** probability of a 1-ply, no-quiescence "tactics blind" move */
  blind: number
  nullMove: boolean
  lmr: boolean
  /** probability of using the opening book */
  book: number
  /** search time cap in ms (never above 2300) */
  timeMs: number
  /** natural delay range in ms */
  thinkMin: number
  thinkMax: number
}

type Anchor = Omit<Level, 'skill' | 'nullMove' | 'lmr'>

const ANCHORS: [number, Anchor][] = [
  [0, { depth: 0, nodes: 1500, qDepth: 0, noise: 300, topK: 6, spread: 400, blunder: 0.3, blind: 0.5, book: 0, timeMs: 400, thinkMin: 300, thinkMax: 700 }],
  [10, { depth: 1, nodes: 2500, qDepth: 0, noise: 160, topK: 5, spread: 250, blunder: 0.24, blind: 0.4, book: 0.05, timeMs: 600, thinkMin: 400, thinkMax: 1000 }],
  [20, { depth: 2, nodes: 4000, qDepth: 0, noise: 110, topK: 4, spread: 160, blunder: 0.18, blind: 0.3, book: 0.1, timeMs: 800, thinkMin: 450, thinkMax: 1200 }],
  [30, { depth: 2, nodes: 8000, qDepth: 2, noise: 80, topK: 3, spread: 110, blunder: 0.12, blind: 0.2, book: 0.2, timeMs: 1000, thinkMin: 400, thinkMax: 1200 }],
  [40, { depth: 3, nodes: 20000, qDepth: 4, noise: 55, topK: 3, spread: 80, blunder: 0.08, blind: 0.1, book: 0.35, timeMs: 1300, thinkMin: 350, thinkMax: 1100 }],
  [50, { depth: 3, nodes: 50000, qDepth: 6, noise: 35, topK: 2, spread: 55, blunder: 0.05, blind: 0.04, book: 0.5, timeMs: 1600, thinkMin: 300, thinkMax: 1000 }],
  [60, { depth: 4, nodes: 120000, qDepth: 8, noise: 22, topK: 2, spread: 40, blunder: 0.03, blind: 0, book: 0.65, timeMs: 1900, thinkMin: 300, thinkMax: 900 }],
  [70, { depth: 5, nodes: 300000, qDepth: 10, noise: 12, topK: 2, spread: 25, blunder: 0.015, blind: 0, book: 0.8, timeMs: 2100, thinkMin: 300, thinkMax: 800 }],
  [80, { depth: 6, nodes: 700000, qDepth: 12, noise: 5, topK: 1, spread: 10, blunder: 0, blind: 0, book: 0.9, timeMs: 2200, thinkMin: 300, thinkMax: 700 }],
  [90, { depth: 8, nodes: 1500000, qDepth: 14, noise: 0, topK: 1, spread: 0, blunder: 0, blind: 0, book: 1, timeMs: 2300, thinkMin: 300, thinkMax: 600 }],
  [100, { depth: 12, nodes: 4000000, qDepth: 16, noise: 0, topK: 1, spread: 0, blunder: 0, blind: 0, book: 1, timeMs: 2300, thinkMin: 300, thinkMax: 500 }],
]

const INTEGER_KEYS = new Set(['depth', 'nodes', 'qDepth', 'topK', 'timeMs', 'thinkMin', 'thinkMax', 'noise', 'spread'])

export function levelFor(skill: number): Level {
  const s = Math.max(0, Math.min(100, skill))
  const i = Math.min(9, Math.floor(s / 10))
  const [s0, a] = ANCHORS[i]!
  const [s1, b] = ANCHORS[i + 1]!
  const t = (s - s0) / (s1 - s0)
  const out: Record<string, number> = {}
  for (const k of Object.keys(a) as (keyof Anchor)[]) {
    const v = a[k] + (b[k] - a[k]) * t
    out[k] = INTEGER_KEYS.has(k) ? Math.round(v) : Math.round(v * 1000) / 1000
  }
  return {
    skill: s,
    ...(out as unknown as Anchor),
    nullMove: s >= 50,
    lmr: s >= 40,
  }
}

/** Skill to approximate Elo, interpolated over anchors (see docs/calibration.md). */
const ELO_ANCHORS: [number, number][] = [
  [0, 400],
  [20, 800],
  [50, 1300],
  [80, 1700],
  [100, 1900],
]

export function eloForSkill(skill: number): number {
  const s = Math.max(0, Math.min(100, skill))
  for (let i = 0; i < ELO_ANCHORS.length - 1; i++) {
    const [s0, e0] = ELO_ANCHORS[i]!
    const [s1, e1] = ELO_ANCHORS[i + 1]!
    if (s <= s1) return e0 + ((e1 - e0) * (s - s0)) / (s1 - s0)
  }
  return ELO_ANCHORS[ELO_ANCHORS.length - 1]![1]
}

export function skillForElo(elo: number): number {
  if (elo <= ELO_ANCHORS[0]![1]) return 0
  for (let i = 0; i < ELO_ANCHORS.length - 1; i++) {
    const [s0, e0] = ELO_ANCHORS[i]!
    const [s1, e1] = ELO_ANCHORS[i + 1]!
    if (elo <= e1) return s0 + ((s1 - s0) * (elo - e0)) / (e1 - e0)
  }
  return 100
}
