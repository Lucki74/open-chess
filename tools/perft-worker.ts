// Perft in a real worker thread. Run: npx tsx tools/perft-worker.ts
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { Position } from '../src/engine/board'

function perft(p: Position, d: number): number {
  if (d === 0) return 1
  let n = 0
  for (const m of p.legalMoves()) {
    p.makeMove(m)
    n += perft(p, d - 1)
    p.unmakeMove()
  }
  return n
}

if (isMainThread) {
  const t0 = performance.now()
  const w = new Worker(fileURLToPath(import.meta.url), { execArgv: ['--import', 'tsx'] })
  w.on('message', (n: number) => {
    const ms = Math.round(performance.now() - t0)
    console.log(`perft5 = ${n} in ${ms} ms (including worker start)`)
    process.exit(n === 4865609 && ms < 3000 ? 0 : 1)
  })
} else {
  parentPort!.postMessage(perft(new Position(), 5))
}
