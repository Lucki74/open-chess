import { _electron as electron } from 'playwright'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-w-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${ud}`], cwd: process.cwd() })
const w = await app.firstWindow(); await w.waitForSelector('.sq'); await w.waitForTimeout(500)
const r = await w.evaluate(async () => {
  const A = window.__app
  const out = {}
  const E = A.bot
  const mids = [[], ['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6','d2d3','f8c5','c2c3','d7d6']]
  const times = {}
  for (const sk of [0, 25, 50, 75, 100]) {
    let mx = 0
    for (const h of mids) { const t = performance.now(); await E.move('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', h, sk, { standardStart: true }); mx = Math.max(mx, performance.now() - t) }
    times[sk] = Math.round(mx)
  }
  out.times = times
  // fps during search
  let frames = 0, maxGap = 0, last = performance.now(), run = true
  const tick = (t) => { frames++; maxGap = Math.max(maxGap, t - last); last = t; if (run) requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const t0 = performance.now()
  await E.move('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', mids[1], 100, { standardStart: true })
  const dur = performance.now() - t0
  run = false
  out.fps = Math.round(frames / (dur / 1000)); out.maxGapMs = Math.round(maxGap); out.searchMs = Math.round(dur)
  // cancel
  const p = E.move('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', mids[1], 100, { standardStart: true })
  setTimeout(() => E.cancel(), 100)
  try { await p; out.cancel = 'not rejected' } catch (e) { out.cancel = e.message }
  const m = await E.move('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [], 20, { standardStart: true })
  out.afterCancel = typeof m.move
  // error path
  try { await E.evaluate('garbage fen', 2); out.err = 'no error' } catch (e) { out.err = e.message }
  const m2 = await E.evaluate('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 3)
  out.afterErr = typeof m2.move
  return out
})
console.log(JSON.stringify(r))
await app.close()
