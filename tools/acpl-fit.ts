// Records the bot's own ACPL at skills 0..100 vs a fixed mid opponent (skill 50) to refit ACPL_ELO_CURVE.
// Usage: npx tsx tools/acpl-fit.ts [--games 8] [--timeCap 100] [--opp 50]
// Each skill runs in its own child process. Prints a table and a suggested monotone curve.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { eloForSkill } from '../src/engine/levels'
import { playMatch } from '../src/skill/simgame'
import { summarize } from '../src/skill/analysis'
import { mixSeed } from '../src/skill/simulate'

const SKILLS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const SELF = fileURLToPath(import.meta.url)

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback
}

interface SkillRow {
  skill: number
  elo: number
  acpl: number
  sd: number
  games: number
  gameAcpls: number[]
}

function runSkill(skill: number, games: number, timeCap: number, opp: number): SkillRow {
  const acpls: number[] = []
  for (let g = 0; g < games; g++) {
    const testedWhite = g % 2 === 0
    const base = mixSeed(7, skill, g)
    const tested = { skill, seed: mixSeed(base, 1), analyse: true }
    const other = { skill: opp, seed: mixSeed(base, 2), analyse: false }
    const res = playMatch({
      white: testedWhite ? tested : other,
      black: testedWhite ? other : tested,
      seed: mixSeed(base, 3),
      timeCapMs: timeCap,
      openingPlies: 2,
      analysisDepth: 3,
    })
    const s = summarize(res.losses[testedWhite ? 'white' : 'black'])
    if (s.acpl !== null) acpls.push(s.acpl)
  }
  const mean = acpls.reduce((a, b) => a + b, 0) / Math.max(1, acpls.length)
  const sd = Math.sqrt(acpls.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, acpls.length - 1))
  return { skill, elo: eloForSkill(skill), acpl: mean, sd, games: acpls.length, gameAcpls: acpls.map((x) => Math.round(x * 10) / 10) }
}

function childMain(): void {
  const i = process.argv.indexOf('--child')
  const [skill, games, timeCap, opp] = process.argv.slice(i + 1, i + 5).map(Number)
  const row = runSkill(skill!, games!, timeCap!, opp!)
  process.stdout.write(`RESULT ${JSON.stringify(row)}\n`)
}

function runChild(skill: number, games: number, timeCap: number, opp: number): Promise<SkillRow> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', SELF, '--child', String(skill), String(games), String(timeCap), String(opp)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.on('error', reject)
    child.on('close', (code) => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '))
      if (code !== 0 || !line) return reject(new Error(`skill ${skill} failed (code ${code})`))
      resolve(JSON.parse(line.slice(7)) as SkillRow)
    })
  })
}

async function main(): Promise<void> {
  const games = Number(arg('--games', '8'))
  const timeCap = Number(arg('--timeCap', '100'))
  const opp = Number(arg('--opp', '50'))
  const rows = await Promise.all(SKILLS.map((s) => runChild(s, games, timeCap, opp)))

  console.log('skill  elo   acpl    sd     n')
  for (const r of rows)
    console.log(`${String(r.skill).padEnd(6)} ${String(Math.round(r.elo)).padEnd(5)} ${r.acpl.toFixed(1).padEnd(7)} ${r.sd.toFixed(1).padEnd(6)} ${r.games}`)

  // Monotone curve: sort by ACPL ascending, Elo must not rise with ACPL (pool adjacent violators).
  const pts = rows.map((r) => ({ acpl: r.acpl, elo: r.elo, w: r.games })).sort((a, b) => a.acpl - b.acpl)
  const blocks: { acplSum: number; eloSum: number; w: number }[] = []
  for (const p of pts) {
    blocks.push({ acplSum: p.acpl * p.w, eloSum: p.elo * p.w, w: p.w })
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!
      const a = blocks[blocks.length - 2]!
      if (a.eloSum / a.w >= b.eloSum / b.w) break
      blocks.splice(-2, 2, { acplSum: a.acplSum + b.acplSum, eloSum: a.eloSum + b.eloSum, w: a.w + b.w })
    }
  }
  const curve = blocks.map((b) => [Math.round(b.acplSum / b.w), Math.round(b.eloSum / b.w)] as [number, number])
  console.log('suggested ACPL_ELO_CURVE (PAV):', JSON.stringify(curve))
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows))
}

if (process.argv.includes('--child')) childMain()
else void main()
