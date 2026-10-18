import { _electron as electron } from 'playwright'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-d-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${ud}`], cwd: process.cwd() })
const w = await app.firstWindow(); await w.waitForSelector('.sq'); await w.waitForTimeout(500)
const c = async (sq) => { const b = await w.locator(`[data-sq="${sq}"]`).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2] }
const drag = async (a, b) => { const [x1, y1] = await c(a), [x2, y2] = await c(b); await w.mouse.move(x1, y1); await w.mouse.down(); await w.mouse.move((x1+x2)/2, (y1+y2)/2, { steps: 4 }); await w.mouse.move(x2, y2, { steps: 4 }); await w.mouse.up() }
await drag('e2', 'e5'); await w.waitForTimeout(400)
console.log('illegal drop plies', await w.evaluate(() => window.__app.g.uci.length), 'ghosts', await w.locator('.drag-ghost').count())
await drag('e2', 'e4'); await w.waitForTimeout(300)
console.log('legal drop', await w.evaluate(() => window.__app.g.uci.join()))
await w.waitForFunction(() => document.querySelector('.board').dataset.busy === 'false', null, { timeout: 8000 })
await w.click('[data-sq="g1"]'); await w.click('[data-sq="f3"]'); await w.waitForTimeout(300)
console.log('click still works', await w.evaluate(() => window.__app.g.uci.join()))
await app.close()
