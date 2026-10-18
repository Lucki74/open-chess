// Focus ring check: keyboard-focused square shows the two-tone ring on light and dark squares.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-focus-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${ud}`], cwd: ROOT })
const w = await app.firstWindow()
await w.waitForFunction(() => window.__app && document.querySelector('.board'))
await w.keyboard.press('Tab')
let fails = 0
for (const sq of ['e2', 'e4']) {
  await w.locator(`[data-sq="${sq}"]`).focus()
  await w.keyboard.press('ArrowRight')
  const info = await w.evaluate(() => {
    const el = document.activeElement
    const cs = getComputedStyle(el)
    return { sq: el.dataset.sq, fv: el.matches(':focus-visible'), shadow: cs.boxShadow }
  })
  const ok = info.fv && info.shadow.includes('rgb(16, 36, 26)') && info.shadow.includes('rgb(255, 243, 168)')
  if (!ok) fails++
  console.log(ok ? 'PASS' : 'FAIL', info.sq, info.fv, info.shadow)
  await w.locator('.board').screenshot({ path: path.join(ROOT, 'shots', `focus-${info.sq}.png`) })
}
await app.close()
console.log(fails ? `${fails} failed` : 'focus ring pass')
process.exitCode = fails ? 1 : 0
