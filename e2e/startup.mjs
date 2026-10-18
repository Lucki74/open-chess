import { _electron as electron } from 'playwright'
const t0 = Date.now()
const app = await electron.launch({ executablePath: 'release/win-unpacked/open_chess.exe' })
const win = await app.firstWindow()
await win.waitForSelector('.board .sq', { timeout: 10000 })
console.log('ready ms', Date.now() - t0)
const mem = await app.evaluate(({ app }) => app.getAppMetrics().reduce((s, m) => s + m.memory.workingSetSize, 0) / 1024)
console.log('mem MB', Math.round(mem))
await app.close()
