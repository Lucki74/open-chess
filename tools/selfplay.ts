// Self-play ladder: bot skills 0,10..100 play each other; prints scores and fitted Elo per skill.
// Usage: npx tsx tools/selfplay.ts [gamesPerPair=40] [capMs=150] [procs=24] [maxGap=20]
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Bot } from '../src/engine/bot'
import { botMover, playGame, rngFrom } from '../src/engine/match'

const SKILLS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const args = process.argv.slice(2)

interface Job {
  a: number
  b: number
  game: number
  capMs: number
}
interface Res extends Job {
  /** score for a: 1 win, .5 draw, 0 loss */
  score: number
  plies: number
}

if (args[0] === '--child') {
  const jobs: Job[] = JSON.parse(args[1]!)
  const botA = new Bot(16)
  const botB = new Bot(16)
  for (const j of jobs) {
    const rng = rngFrom(j.a * 7919 + j.b * 104729 + j.game * 31)
    const aWhite = j.game % 2 === 0
    const ma = botMover(j.a, rng, j.capMs, botA)
    const mb = botMover(j.b, rng, j.capMs, botB)
    // both games of a pair share the same opening via game>>1
    const orng = rngFrom(j.a * 31 + j.b * 17 + (j.game >> 1) * 977)
    const o = playGame(aWhite ? ma : mb, aWhite ? mb : ma, { openingPlies: 4, rng: orng, maxPlies: 300 })
    const sc = o.result === 0 ? 0.5 : (o.result === 1) === aWhite ? 1 : 0
    const r: Res = { ...j, score: sc, plies: o.plies }
    process.stdout.write(JSON.stringify(r) + '\n')
  }
  process.exit(0)
}

const games = Number(args[0] ?? 40)
const capMs = Number(args[1] ?? 150)
const procs = Number(args[2] ?? 24)
const maxGap = Number(args[3] ?? 20)

const jobs: Job[] = []
for (let i = 0; i < SKILLS.length; i++)
  for (let j = i + 1; j < SKILLS.length; j++) {
    if (SKILLS[j]! - SKILLS[i]! > maxGap) continue
    for (let g = 0; g < games; g++) jobs.push({ a: SKILLS[j]!, b: SKILLS[i]!, game: g, capMs })
  }
// interleave so each process gets a mix of cheap and expensive jobs
const buckets: Job[][] = Array.from({ length: procs }, () => [])
jobs.forEach((j, i) => buckets[i % procs]!.push(j))

const results: Res[] = []
let finished = 0
const self = fileURLToPath(import.meta.url)
const t0 = Date.now()
for (const b of buckets) {
  if (!b.length) {
    finished++
    continue
  }
  const p = spawn(process.execPath, ['--import', 'tsx', self, '--child', JSON.stringify(b)], { stdio: ['ignore', 'pipe', 'inherit'] })
  let buf = ''
  p.stdout.on('data', (d: Buffer) => {
    buf += d.toString()
    let k: number
    while ((k = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, k)
      buf = buf.slice(k + 1)
      if (line.trim()) results.push(JSON.parse(line) as Res)
    }
  })
  p.on('exit', () => {
    if (++finished === buckets.length) report()
  })
}

function report(): void {
  const pair = new Map<string, { s: number; n: number }>()
  for (const r of results) {
    const k = `${r.a}-${r.b}`
    const e = pair.get(k) ?? { s: 0, n: 0 }
    e.s += r.score
    e.n++
    pair.set(k, e)
  }
  console.log(`games: ${results.length}/${jobs.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s (cap ${capMs}ms)`)
  for (const [k, e] of [...pair].sort((x, y) => Number(x[0].split('-')[0]) - Number(y[0].split('-')[0]))) {
    const [a, b] = k.split('-')
    console.log(`skill ${a} vs ${b}: ${e.s}/${e.n} = ${((100 * e.s) / e.n).toFixed(0)}%`)
  }
  // Fit ratings by gradient ascent on the logistic likelihood, skill 0 anchored at 0.
  const R = new Map<number, number>(SKILLS.map((s) => [s, 0]))
  for (let it = 0; it < 4000; it++) {
    const grad = new Map<number, number>(SKILLS.map((s) => [s, 0]))
    for (const [k, e] of pair) {
      const [a, b] = k.split('-').map(Number) as [number, number]
      const exp = 1 / (1 + 10 ** ((R.get(b)! - R.get(a)!) / 400))
      const d = e.s - exp * e.n
      grad.set(a, grad.get(a)! + d)
      grad.set(b, grad.get(b)! - d)
    }
    for (const s of SKILLS) R.set(s, R.get(s)! + 0.6 * grad.get(s)!)
    const base = R.get(0)!
    for (const s of SKILLS) R.set(s, R.get(s)! - base)
  }
  const table = SKILLS.map((s) => ({ skill: s, elo: Math.round(R.get(s)!) }))
  console.log('fitted Elo (skill 0 = 0):')
  for (const t of table) console.log(`  ${t.skill}: ${t.elo}`)
  let mono = true
  for (let i = 1; i < table.length; i++) if (table[i]!.elo <= table[i - 1]!.elo) mono = false
  console.log(mono ? 'MONOTONE' : 'NOT MONOTONE')
  writeFileSync('docs/selfplay-last.json', JSON.stringify({ games, capMs, table, pairs: Object.fromEntries(pair) }, null, 1))
}
