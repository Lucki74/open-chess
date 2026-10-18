import { _electron as electron } from 'playwright'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-o-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${ud}`], cwd: process.cwd() })
const w = await app.firstWindow(); await w.waitForSelector('.sq')
for (const [W,H] of [[1100,720],[760,560]]) {
await app.evaluate(({ BrowserWindow }, [W,H]) => BrowserWindow.getAllWindows()[0].setContentSize(W,H), [W,H]); await w.waitForTimeout(400)
console.log(W,H, await w.evaluate(() => ({ih: innerHeight, sh: document.documentElement.scrollHeight, bh: document.body.scrollHeight, app: document.getElementById('app').scrollHeight, shell: document.querySelector('.shell').scrollHeight})))
await w.screenshot({path:`shots/o${W}.png`})}
await app.close()
