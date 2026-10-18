import { _electron as electron } from 'playwright'
const t0 = Date.now()
const app = await electron.launch({ executablePath: 'release/win-unpacked/open_chess.exe' })
const win = await app.firstWindow()
await win.waitForSelector('.board .sq')
const startMs = Date.now() - t0
// play 20 quick bot games at skill via UI-less: drive moves with __app if available
for (let g = 0; g < 20; g++) {
  await win.evaluate(async () => {
    const a = window.__app
    if (a && a.newGame) await a.newGame()
  })
  for (let i = 0; i < 4; i++) {
    const mv = await win.evaluate(() => {
      const a = window.__app
      return a?.hasOwnProperty('legalUci') ? a.legalUci?.() : null
    })
    if (!mv) break
  }
}
const m = await app.evaluate(({ app }) => app.getAppMetrics().map(x => ({ t: x.type, ws: x.memory.workingSetSize, pv: x.memory.privateBytes })))
console.log('start', startMs, JSON.stringify(m), 'sumPrivateMB', Math.round(m.reduce((s, x) => s + (x.pv||0), 0) / 1024))
await app.close()
