// UI verification: security, keyboard, aria, undo/hint limits, bot crash toast, resign, colour, mute, minimise, castling and en passant.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const SHOTS = path.join(ROOT, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-ui-'))
const R = []
const ok = (n, c, x = '') => {
  R.push([c ? 'PASS' : 'FAIL', n, x])
  console.log(c ? 'PASS' : 'FAIL', n, x)
}
const launch = () => electron.launch({ args: ['.', `--user-data-dir=${ud}`], cwd: ROOT })
const waitBot = async (w) => {
  await w.waitForFunction(() => document.querySelector('.board').dataset.busy === 'false', null, { timeout: 10000, polling: 100 })
  await w.waitForTimeout(120)
}
const mv = async (w, a, b) => {
  await w.click(`[data-sq="${a}"]`)
  await w.click(`[data-sq="${b}"]`)
}
const st = (w) =>
  w.evaluate(() => {
    const a = window.__app
    return { plies: a.g.uci.length, uci: a.g.uci.slice(), undos: a.undos, hints: a.hints, phase: a.phase, color: a.color, games: a.data.games.length, muted: a.data.muted }
  })
const setPos = (w, uci, color) =>
  w.evaluate(
    ([uci, color]) => {
      const a = window.__app
      a.token++
      a.bot.cancel()
      a.closePromo?.()
      a.color = color
      a.flipped = color === 'b'
      a.g = new a.g.constructor(undefined, uci)
      a.sel = null
      a.targets.clear()
      a.hintSq = null
      a.afterSetup()
    },
    [uci, color],
  )
const toastText = (w) => w.evaluate(() => document.querySelector('.toast')?.textContent ?? '')
const sq = (w, s) => w.evaluate((s) => document.querySelector(`[data-sq="${s}"]`).dataset.p, s)

// ---------- session 1: fresh profile ----------
let app = await launch()
let w = await app.firstWindow()
await w.waitForSelector('.board .sq')
await w.waitForTimeout(400)

// security
const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())
ok('contextIsolation true', prefs.contextIsolation === true)
ok('nodeIntegration false', prefs.nodeIntegration === false)
ok('sandbox true', prefs.sandbox === true)
const env = await w.evaluate(() => ({ req: typeof require, proc: typeof process, bridge: typeof window.chessApi }))
ok('renderer has no node globals', env.req === 'undefined' && env.proc === 'undefined', JSON.stringify(env))
const csp = await w.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '')
ok('CSP meta present, default-src none', csp.includes("default-src 'none'") && csp.includes("script-src 'self'") && !csp.includes('unsafe-eval'), csp.slice(0, 60))
await w.evaluate(() => window.open('https://example.com/'))
await w.waitForTimeout(300)
ok('window.open blocked (single window)', app.windows().length === 1, `windows=${app.windows().length}`)
// keyboard play: ArrowUp x1 focuses e3, ArrowDown focuses e2, Enter selects, ArrowUp x2 to e4, Enter moves
await w.keyboard.press('ArrowUp')
await w.keyboard.press('ArrowDown')
const focused = await w.evaluate(() => document.activeElement?.dataset.sq)
ok('arrow keys move focus on board', focused === 'e2', `focus=${focused}`)
const lbl = await w.getAttribute('[data-sq="e2"]', 'aria-label')
ok('square aria-label e2', lbl === 'e2, white pawn', lbl)
const emptyLbl = await w.getAttribute('[data-sq="e4"]', 'aria-label')
ok('empty square aria-label', emptyLbl === 'e4, empty', emptyLbl)
await w.keyboard.press('Enter')
const selected = await w.getAttribute('[data-sq="e2"]', 'aria-selected')
const targetsOn = await w.locator('.sq.target').count()
ok('Enter selects piece and shows targets', selected === 'true' && targetsOn >= 2, `targets=${targetsOn}`)
await w.keyboard.press('ArrowUp')
await w.keyboard.press('ArrowUp')
await w.keyboard.press('Enter')
await w.waitForTimeout(150)
let uciNow = (await st(w)).uci
ok('keyboard move e2e4 with Enter', uciNow[0] === 'e2e4', uciNow.join(' '))
const live1 = await w.textContent('.sr')
await waitBot(w)
ok('live region announces player move', /You played e4/.test(live1), live1)
await new Promise((r) => setTimeout(r, 300))
const live2 = await w.textContent('.sr')
ok('live region announces bot move', /Bot played/.test(live2), live2)

// keyboard with Space: g1 -> f3
await w.evaluate(() => document.querySelector('[data-sq="g1"]').focus())
await w.keyboard.press('Space')
await w.keyboard.press('ArrowLeft')
await w.keyboard.press('ArrowUp')
await w.keyboard.press('ArrowUp')
await w.keyboard.press('Space')
await w.waitForTimeout(150)
uciNow = (await st(w)).uci
ok('keyboard move g1f3 with Space', uciNow.includes('g1f3'), uciNow.join(' '))
await waitBot(w)

// undo: three allowed, fourth refused silently (fresh count via setPos)
await setPos(w, [], 'w')
await waitBot(w)
let s = await st(w)
ok('setup start position for undo count', s.plies === 0 && s.color === 'w' && s.undos === 0, `plies=${s.plies}`)
await mv(w, 'e2', 'e4')
await waitBot(w)
await w.keyboard.press('Control+z')
await w.waitForTimeout(150)
s = await st(w)
ok('undo #1 leaves zero plies', s.undos === 1 && s.plies === 0, `undos=${s.undos} plies=${s.plies}`)
await mv(w, 'd2', 'd4')
await waitBot(w)
await w.keyboard.press('Control+z')
await w.waitForTimeout(150)
await mv(w, 'g1', 'f3')
await waitBot(w)
await w.keyboard.press('Control+z')
await w.waitForTimeout(150)
s = await st(w)
ok('undo #3 accepted', s.undos === 3, `undos=${s.undos} plies=${s.plies}`)
await mv(w, 'e2', 'e4')
await waitBot(w)
const plyBefore = (await st(w)).plies
await w.keyboard.press('Control+z')
await w.waitForTimeout(250)
s = await st(w)
const toast4 = await toastText(w)
ok('undo #4 refused', s.undos === 3 && s.plies === plyBefore, `undos=${s.undos} plies=${s.plies}`)
ok('undo #4 shows no message', toast4 === '', `toast="${toast4}"`)

// hints: three allowed, fourth refused
for (let i = 1; i <= 3; i++) {
  await w.keyboard.press('h')
  await w.waitForTimeout(900)
  const glow = await w.locator('.sq.hint').count()
  ok(`hint ${i} glows two squares`, glow === 2 && (await st(w)).hints === i, `glow=${glow}`)
  await w.waitForTimeout(1000)
}
await w.keyboard.press('h')
await w.waitForTimeout(400)
s = await st(w)
ok('hint #4 refused', s.hints === 3 && (await w.locator('.sq.hint').count()) === 0, `hints=${s.hints}`)
ok('hint #4 shows message', (await toastText(w)).includes('No hints left'))

// bot restart: crash the engine worker mid-think
await w.waitForTimeout(2600)
await waitBot(w)
s = await st(w)
const pl = s.plies
await mv(w, 'd2', 'd4').catch(() => {})
await w.evaluate(() => {
  const worker = window.__app.bot.worker
  worker?.dispatchEvent(new ErrorEvent('error', { message: 'simulated crash' }))
})
await w.waitForTimeout(200)
const crashToast = await toastText(w)
ok('worker crash shows "Bot restarted" toast', crashToast === 'Bot restarted', `toast="${crashToast}"`)
await waitBot(w)
await w.waitForTimeout(600)
s = await st(w)
ok('game continues after worker restart', s.phase === 'player' && s.plies > pl, `plies=${s.plies} phase=${s.phase}`)

// resign: N once arms, N again resigns, next game puts bot first as black
const games0 = (await st(w)).games
await w.keyboard.press('n')
await w.waitForTimeout(150)
ok('first N arms resign with message', (await toastText(w)).includes('Press N again'))
ok('first N does not end game', (await st(w)).games === games0)
await w.keyboard.press('n')
await w.waitForTimeout(6000)
s = await st(w)
ok('second N resigns and saves loss', s.games === games0 + 1, `games=${s.games}`)
const last = await w.evaluate(() => window.__app.data.games.at(-1))
ok('resigned game recorded as loss/resign', last.result === 'loss' && last.termination === 'resign', `${last.result}/${last.termination}`)
await w.waitForTimeout(800)
s = await st(w)
ok('next game: player is black', s.color === 'b', `color=${s.color}`)
ok('bot moves first as white for black player', s.uci.length === 1 && s.plies === 1 && s.phase === 'player', `uci=${s.uci.join(' ')}`)
const botFirst = await w.evaluate(() => window.__app.g.uci[0])
ok('first move is white (bot)', !!botFirst && botFirst.length >= 4)

// mute toggle, persisted (checked after relaunch)
await w.keyboard.press('m')
await w.waitForTimeout(150)
s = await st(w)
ok('M mutes', s.muted === true && (await toastText(w)) === 'Sound off', `muted=${s.muted}`)
const uciBeforeClose = (await st(w)).uci
await app.close()

// ---------- session 2: relaunch ----------
app = await launch()
w = await app.firstWindow()
await w.waitForSelector('.board .sq')
await w.waitForTimeout(600)
s = await st(w)
ok('mute state remembered after relaunch', s.muted === true, `muted=${s.muted}`)
ok('in-progress game resumed after relaunch', JSON.stringify(s.uci) === JSON.stringify(uciBeforeClose), `uci=${s.uci.join(' ')}`)
await w.keyboard.press('m')
await w.waitForTimeout(150)
s = await st(w)
ok('M unmutes', s.muted === false)

// minimise: sound must not play while window is hidden
await w.evaluate(() => {
  const P = Object.getPrototypeOf(AudioContext.prototype)
  if (!window.__oscPatched) {
    const orig = P.createOscillator
    P.createOscillator = function () {
      window.__osc = (window.__osc || 0) + 1
      return orig.call(this)
    }
    window.__oscPatched = true
  }
  window.__osc = 0
})
await setPos(w, [], 'w')
await waitBot(w)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
await w.waitForTimeout(800)
const mini = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())
ok('window minimised', mini === true)
await w.evaluate(() => window.__app.commit('d2d4'))
await waitBot(w)
await w.waitForTimeout(300)
const oscMin = await w.evaluate(() => window.__osc)
ok('no sound while minimised (player and bot move)', oscMin === 0, `oscillators=${oscMin}`)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
await w.waitForTimeout(800)
await setPos(w, [], 'w')
await waitBot(w)
await mv(w, 'e2', 'e4')
await w.waitForTimeout(300)
const oscOn = await w.evaluate(() => window.__osc)
ok('sound plays when window visible', oscOn > 0, `oscillators=${oscOn}`)
await waitBot(w)

// castling: rook and king move together
await setPos(w, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'], 'w')
await waitBot(w)
await w.evaluate(() => {
  if (window.__animPatched) return
  window.__animPatched = true
  window.__anims = []
  const orig = Element.prototype.animate
  Element.prototype.animate = function (k, o) {
    window.__anims.push(this.getAttribute('class') + '|' + this.closest('[data-sq]')?.dataset.sq)
    return orig.call(this, k, o)
  }
})
await w.evaluate(() => (window.__anims = []))
await mv(w, 'e1', 'g1')
await w.waitForTimeout(120)
const castle = await Promise.all(['e1', 'f1', 'g1', 'h1'].map((x) => sq(w, x)))
ok('castling O-O places king g1 and rook f1', castle[2] === 'wk' && castle[1] === 'wr' && castle[0] === '' && castle[3] === '', castle.join(','))
const anims = await w.evaluate(() => window.__anims.slice())
ok('castling animates king and rook', anims.filter((a) => a.startsWith('piece')).length === 2, anims.join(' ; '))
await waitBot(w)

// en passant: d6 removes the pawn on d5
await setPos(w, ['e2e4', 'a7a6', 'e4e5', 'd7d5'], 'w')
await waitBot(w)
await w.evaluate(() => (window.__anims = []))
await mv(w, 'e5', 'd6')
await w.waitForTimeout(120)
const ep = await Promise.all(['d5', 'd6', 'e5'].map((x) => sq(w, x)))
ok('en passant removes pawn on d5', ep[0] === '' && ep[1] === 'wp' && ep[2] === '', ep.join(','))
const epAnims = await w.evaluate(() => window.__anims.slice())
ok('en passant animates capture ghost', epAnims.some((a) => a.startsWith('ghost')), epAnims.join(' ; '))
await waitBot(w)

// ---------- screenshots at three sizes ----------
await setPos(w, ['e2e4', 'e7e5', 'g1f3'], 'b')
await waitBot(w)
const corner = await w.evaluate(() => {
  const e = document.querySelector('.sq.last')
  return e ? getComputedStyle(e, '::before').backgroundImage : ''
})
ok('last move has corner mark (not colour only)', corner.includes('gradient'), corner.slice(0, 50))
await setPos(w, [], 'w')
await waitBot(w)
for (const [name, cw, ch] of [
  ['ui-1100', 1100, 720],
  ['ui-930', 930, 640],
  ['ui-760', 760, 560],
]) {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [cw, ch])
  await w.waitForTimeout(500)
  const inner = await w.evaluate(() => [innerWidth, innerHeight])
  await w.screenshot({ path: path.join(SHOTS, name + '.png') })
  const boardBox = await w.locator('.board').boundingBox()
  const overflow = await w.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  ok(`screenshot ${name}`, boardBox && boardBox.width >= 320 && !overflow, `viewport=${inner.join('x')} board=${Math.round(boardBox.width)}`)
}

await w.evaluate(() => {
  window.location.href = 'https://example.com/'
})
await w.waitForTimeout(500)
ok('navigation blocked', w.url().startsWith('file:'), w.url().slice(0, 40))

await app.close()
const fails = R.filter((r) => r[0] === 'FAIL').length
console.log(`\n${R.length - fails}/${R.length} pass`)
fs.writeFileSync(path.join(SHOTS, 'verify-ui.json'), JSON.stringify(R, null, 1))
