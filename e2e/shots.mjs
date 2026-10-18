import { _electron as electron } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-ud-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${ud}`], cwd: process.cwd() })
const win = await app.firstWindow()
win.on('console', (m) => console.log('[console]', m.type(), m.text()))
win.on('pageerror', (e) => console.log('[pageerror]', e.message))
await win.waitForSelector('.sq')
await win.waitForTimeout(800)
const size = async (w, h) => {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h])
  await win.waitForTimeout(400)
}
await size(1100, 720)
await win.screenshot({ path: 'shots/desktop.png' })
// play e2e4
await win.click('[data-sq="e2"]')
await win.click('[data-sq="e4"]')
await win.waitForTimeout(2800)
await win.screenshot({ path: 'shots/desktop-after.png' })
await size(760, 560)
await win.screenshot({ path: 'shots/small.png' })
await app.close()
