// Full game through the real Electron UI: clicks only. Run: npx tsx e2e/play.ts
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Position, sqName, mFrom, mTo, mPromo } from '../src/engine/board'
import { Searcher } from '../src/engine/search'

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-e2e-'))
const launch = () => electron.launch({ args: ['.', `--user-data-dir=${ud}`], cwd: process.cwd() })
let app = await launch()
let win = await app.firstWindow()
const errors: string[] = []
win.on('pageerror', (e) => errors.push(e.message))
await win.waitForSelector('.sq')
await win.waitForTimeout(500)

const pos = new Position()
const searcher = new Searcher(18)
let guard = 0
const t0 = Date.now()
while (guard++ < 300) {
  if (await win.locator('.banner').count()) break
  const turn = await win.evaluate(() => (document.querySelector('.board') as HTMLElement).dataset.busy)
  if (turn === 'true') {
    await win.waitForTimeout(150)
    continue
  }
  const moves = await win.evaluate(() => document.querySelectorAll('.moves button').length)
  // sync local position with the UI move list
  if (moves !== (pos as unknown as { ply: number }).ply) {
    const san = await win.evaluate(() => Array.from(document.querySelectorAll('.moves button')).map((b) => b.textContent))
    void san
  }
  // find whose turn via board data: we are white; local pos tracks both sides via the UI history
  const hist = await win.evaluate(() => (window as unknown as { __app: { g: { uci: string[] } } }).__app.g.uci)
  const p = new Position()
  for (const u of hist) p.makeMove(p.parseUci(u))
  if (p.side !== 0) {
    await win.waitForTimeout(150)
    continue
  }
  if (p.legalMoves().length === 0) break
  const best = searcher.search(p, { maxDepth: 4, maxNodes: 2e5, timeMs: 3000, qDepth: 6, nullMove: true, lmr: true }).move
  const uci = sqName(mFrom(best)) + sqName(mTo(best)) + (mPromo(best) ? 'qrbn'[[5,4,3,2].indexOf(mPromo(best))] : '')
  await win.click(`[data-sq="${uci.slice(0, 2)}"]`)
  await win.click(`[data-sq="${uci.slice(2, 4)}"]`)
  if (uci.length === 5) await win.keyboard.press(uci[4]!)
  await win.waitForTimeout(80)
}
console.log('game loop done in', Math.round((Date.now() - t0) / 1000), 's, errors:', errors)
await win.waitForSelector('.banner h2', { timeout: 5000 })
console.log('banner:', await win.locator('.banner h2').innerText(), '|', await win.locator('.banner p').innerText())
await win.waitForTimeout(6000) // rating update and save
console.log('tally:', await win.locator('.tally').innerText())
console.log('rows:', await win.locator('.game').count())
await win.screenshot({ path: 'shots/after-game.png' })
await app.close()

const file = path.join(ud, 'history.json')
const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
console.log('saved games:', saved.games.length, 'inProgress:', saved.inProgress, 'result:', saved.games[0]?.result, 'acpl:', saved.games[0]?.acpl)

app = await launch()
win = await app.firstWindow()
await win.waitForSelector('.game')
console.log('after relaunch rows:', await win.locator('.game').count(), 'colour next:', await win.evaluate(() => (window as unknown as { __app: { color: string } }).__app.color))
await win.screenshot({ path: 'shots/relaunch.png' })
await app.close()
