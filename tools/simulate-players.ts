// Synthetic players vs the adaptive system. Usage: npx tsx tools/simulate-players.ts [--seeds 1,2,3,4] [--games 40] [--timeCap 100]
// Each (player, seed) runs in its own child process. Exits 1 on any failed check.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { judge, runSyntheticPlayer, type PlayerRun, type Verdict } from '../src/skill/simulate'

const TRUE_ELOS = [600, 900, 1200, 1500, 1800]
const POOL = 24
const RESULT_FILE = fileURLToPath(new URL('../docs/simulation-results.json', import.meta.url))
const SELF = fileURLToPath(import.meta.url)

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback
}

if (process.argv.includes('--child')) {
  const i = process.argv.indexOf('--child')
  const [elo, seed, games, timeCap] = process.argv.slice(i + 1, i + 5).map(Number)
  const run = runSyntheticPlayer({ trueElo: elo!, seed: seed!, games: games!, timeCapMs: timeCap! })
  process.stdout.write(`RESULT ${JSON.stringify(run)}\n`)
} else {
  void main()
}

function runChild(elo: number, seed: number, games: number, timeCap: number): Promise<PlayerRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', SELF, '--child', String(elo), String(seed), String(games), String(timeCap)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.on('error', reject)
    child.on('close', (code) => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT '))
      if (code !== 0 || !line) return reject(new Error(`child elo=${elo} seed=${seed} failed (code ${code})`))
      resolve(JSON.parse(line.slice(7)) as PlayerRun)
    })
  })
}

async function runAll<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const k = next++
      results[k] = await jobs[k]!()
    }
  })
  await Promise.all(workers)
  return results
}

async function main(): Promise<void> {
  const seeds = arg('--seeds', '1,2,3,4').split(',').map(Number)
  const games = Number(arg('--games', '40'))
  const timeCap = Number(arg('--timeCap', '100'))
  const jobs: (() => Promise<PlayerRun>)[] = []
  const keys: { elo: number; seed: number }[] = []
  for (const seed of seeds)
    for (const elo of TRUE_ELOS) {
      keys.push({ elo, seed })
      jobs.push(() => runChild(elo, seed, games, timeCap))
    }
  const t0 = Date.now()
  const runs = await runAll(jobs, POOL)
  const verdicts: Verdict[] = runs.map(judge)

  console.log('seed  true  est@15  err@15  score10-40  maxLossStreak(6+)  maxStep  result')
  runs.forEach((r, k) => {
    const v = verdicts[k]!
    console.log(
      `${String(keys[k]!.seed).padEnd(5)} ${String(r.trueElo).padEnd(5)} ${String(v.ratingAt15).padEnd(7)} ${String(Math.round(v.errorAt15)).padEnd(7)} ${v.scoreGames10to40.toFixed(3).padEnd(11)} ${String(v.maxLossStreakAfter5).padEnd(18)} ${String(Math.round(v.maxStep)).padEnd(8)} ${v.ok ? 'PASS' : 'FAIL ' + JSON.stringify(v.pass)}`,
    )
  })
  const allOk = verdicts.every((v) => v.ok)
  console.log(`${allOk ? 'ALL PASS' : 'FAILURES'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)

  const out = {
    config: { trueElos: TRUE_ELOS, seeds, games, timeCapMs: timeCap, openingPlies: 2, analysisDepth: 3 },
    criteria: {
      estimateWithinElo: 150,
      scoreWindow: [0.4, 0.7],
      maxLossStreakAfterGame: 5,
      maxLossStreak: 4,
    },
    allPass: allOk,
    runs: runs.map((r, k) => ({ seed: keys[k]!.seed, trueElo: r.trueElo, verdict: verdicts[k], games: r.games })),
  }
  writeFileSync(RESULT_FILE, JSON.stringify(out, null, 1) + '\n')
  process.exitCode = allOk ? 0 : 1
}
