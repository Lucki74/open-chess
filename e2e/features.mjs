import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-f-'))
const R = []
const ok = (n, c, extra = '') => { R.push([c ? 'PASS' : 'FAIL', n, extra]); console.log(c ? 'PASS' : 'FAIL', n, extra) }
const launch = () => electron.launch({ args: ['.', `--user-data-dir=${ud}`], cwd: process.cwd() })
const sz = (app, w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h])
const plies = (w) => w.evaluate(() => window.__app.g.uci.length)
const waitBot = async (w) => { await w.waitForFunction(() => document.querySelector('.board').dataset.busy === 'false', null, { timeout: 8000 }); await w.waitForTimeout(150) }
const mv = async (w, a, b) => { await w.click(`[data-sq="${a}"]`); await w.click(`[data-sq="${b}"]`) }

// seed an in-progress game that is one move from promotion, plus a corrupted check later
let app = await launch(); let w = await app.firstWindow()
const errs = []; w.on('pageerror', (e) => errs.push(e.message))
await w.waitForSelector('.sq'); await w.waitForTimeout(400)
ok('no menu', await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null))
// overflow at both sizes
for (const [W, H] of [[1100, 720], [760, 560]]) {
  await sz(app, W, H); await w.waitForTimeout(300)
  const o = await w.evaluate(() => ({ sx: document.documentElement.scrollWidth > innerWidth + 2, sy: document.documentElement.scrollHeight > innerHeight + 2, bad: [...document.querySelectorAll('.shell *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1) && !e.closest('.moves,.past') }).length }))
  ok(`no overflow ${W}x${H}`, !o.sx && !o.sy && o.bad === 0, JSON.stringify(o))
}
await sz(app, 1100, 720)
// play e4, undo
await mv(w, 'e2', 'e4'); await waitBot(w)
ok('bot replied', (await plies(w)) === 2)
await w.keyboard.press('Control+z'); await w.waitForTimeout(300)
ok('undo removes pair', (await plies(w)) === 0)
// hint
await mv(w, 'e2', 'e4'); await waitBot(w)
await w.keyboard.press('h'); await w.waitForTimeout(1500)
ok('hint glow', (await w.locator('.sq.hint, .hint').count()) > 0)
// flip
await w.keyboard.press('f'); await w.waitForTimeout(200)
ok('flip', (await w.locator('.board').getAttribute('data-flip')) !== null)
await w.keyboard.press('f')
// mute persisted
await w.keyboard.press('m'); await w.waitForTimeout(400)
await app.close()
let saved = JSON.parse(fs.readFileSync(path.join(ud, 'history.json'), 'utf8'))
ok('mute saved', saved.muted === true)
ok('in-progress saved', saved.inProgress && saved.inProgress.uci.length >= 2, String(saved.inProgress?.uci?.length))

// resume
app = await launch(); w = await app.firstWindow(); w.on('pageerror', (e) => errs.push(e.message))
await w.waitForSelector('.sq'); await w.waitForTimeout(800)
ok('resume restores moves', (await plies(w)) >= 2)
await app.close()

// promotion: seed position
saved.inProgress = { id: 'p1', startedAt: new Date().toISOString(), playerColor: 'w', fenStart: '7k/P7/8/8/8/8/8/K7 w - - 0 1', moves: [], uci: [], botSkill: 10, playerRatingBefore: 1000, undosUsed: 0, hintsUsed: 0, easingApplied: false, losses: [] }
fs.writeFileSync(path.join(ud, 'history.json'), JSON.stringify(saved))
app = await launch(); w = await app.firstWindow(); w.on('pageerror', (e) => errs.push(e.message))
await w.waitForSelector('.sq'); await w.waitForTimeout(800)
await mv(w, 'a7', 'a8'); await w.waitForTimeout(400)
ok('promo picker', (await w.locator('.promo').count()) > 0)
await w.screenshot({ path: 'shots/promo.png' })
await w.keyboard.press('q'); await w.waitForTimeout(400)
ok('promoted to queen', (await w.evaluate(() => window.__app.g.uci[0])) === 'a7a8q')
await w.waitForTimeout(3000)
await app.close()

// corrupted history
fs.writeFileSync(path.join(ud, 'history.json'), '{not json')
app = await launch(); w = await app.firstWindow(); w.on('pageerror', (e) => errs.push(e.message))
await w.waitForSelector('.sq'); await w.waitForTimeout(800)
ok('corrupt history recovers', (await w.locator('.sq').count()) === 64)
await mv(w, 'd2', 'd4'); await waitBot(w)
ok('plays after corrupt', (await plies(w)) === 2)
ok('backup kept', fs.readdirSync(ud).some((f) => /corrupt|bak/i.test(f)), fs.readdirSync(ud).join(','))
await app.close()

// replay: seed finished game record
saved = JSON.parse(fs.readFileSync(path.join(ud, 'history.json'), 'utf8'))
saved.games = [{ id: 'g1', startedAt: new Date().toISOString(), playerColor: 'w', result: 'win', termination: 'checkmate', moves: ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'], fenStart: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', botSkill: 5, playerRatingBefore: 1000, playerRatingAfter: 1010, acpl: 20, easingApplied: false, hintsUsed: 0 }]
saved.inProgress = null
fs.writeFileSync(path.join(ud, 'history.json'), JSON.stringify(saved))
app = await launch(); w = await app.firstWindow(); w.on('pageerror', (e) => errs.push(e.message))
await w.waitForSelector('.game'); await w.waitForTimeout(500)
await w.locator('.game').first().click(); await w.waitForTimeout(400)
await w.keyboard.press('End'); await w.waitForTimeout(400)
ok('replay end shows queen f7', (await w.locator('[data-sq="f7"] .piece').count()) > 0)
await w.keyboard.press('Home'); await w.waitForTimeout(300)
ok('replay home', (await w.locator('[data-sq="e2"] .piece').count()) > 0)
await w.screenshot({ path: 'shots/replay.png' })
await w.keyboard.press('Escape'); await w.waitForTimeout(300)
ok('esc leaves replay', (await w.evaluate(() => window.__app.replay)) == null)
ok('no page errors', errs.length === 0, errs.join('|'))
await app.close()
console.log(R.filter((r) => r[0] === 'FAIL').length, 'failures')
