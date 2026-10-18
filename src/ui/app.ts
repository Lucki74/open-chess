// Game controller: wires state, engine, skill model, storage, sounds and the view.
import { Position, mFrom, mPromo, mTo, sqName } from '../engine/board'
import { EngineClient } from '../engine/client'
import { eloForSkill, levelFor } from '../engine/levels'
import { ANALYSIS_DEPTH } from '../skill/constants'
import { EasingTracker, chooseBotSkill } from '../skill/adapt'
import { summarize } from '../skill/analysis'
import { cpLoss, initialPlayerState, updateAfterGame } from '../skill/rating'
import type { PlayerState } from '../skill/types'
import { type GameRecord, type InProgressGame, MAX_GAMES, type StoreData, defaultStore } from '../store/types'
import { GameState, type Outcome, type Side, positionAt } from './game'
import { loadStore, saveInProgress, saveStore } from './persist'
import { toSan } from './san'
import * as sound from './sound'
import * as V from './view'

type Phase = 'loading' | 'player' | 'bot' | 'over'
const MAX_UNDO = 3
const MAX_HINT = 3
const BOT_BUDGET_MS = 2500

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))

function uciFromSan(fenStart: string, san: string[]): string[] {
  const pos = new Position(fenStart)
  const out: string[] = []
  for (const s of san) {
    let found = -1
    for (const m of pos.legalMoves()) {
      if (toSan(pos, m) === s) {
        found = m
        break
      }
    }
    if (found < 0) break
    out.push(pos.moveToUci(found))
    pos.makeMove(found)
  }
  return out
}

export class App {
  private refs: V.Refs
  private data: StoreData = defaultStore()
  private player: PlayerState = initialPlayerState()
  private bot = new EngineClient()
  private analyst = new EngineClient()
  private hinter = new EngineClient()
  private g = new GameState()
  private phase: Phase = 'loading'
  private color: Side = 'w'
  private flipped = false
  private sel: string | null = null
  private targets = new Map<string, boolean>()
  private focus = 'e2'
  private hintSq: [string, string] | null = null
  private hintTimer = 0
  private undos = 0
  private hints = 0
  private botSkill = 0
  private botElo = 0
  private ratingBefore = 0
  private easing = new EasingTracker()
  private easingOn = false
  private losses = new Map<number, number>()
  private pending = new Set<Promise<void>>()
  private token = 0
  private gameId = ''
  private startedAt = ''
  private freshGame: string | null = null
  private freshFrom = -1
  private replay: { game: GameRecord; uci: string[]; ply: number } | null = null
  private closePromo: (() => void) | null = null
  private nextTimer = 0
  private resignArmed = 0

  constructor(root: HTMLElement) {
    this.refs = V.build(root)
    this.bot.onRestart = () => V.toast('Bot restarted', 'error')
    this.wire()
    window.chessApi?.onWindowHidden((hidden) => sound.setHidden(hidden))
  }

  async start(): Promise<void> {
    V.renderTally(this.refs, 0, 0, 0)
    V.renderPastLoading(this.refs)
    V.renderMoves(this.refs, [], 0, false, () => {})
    V.setPlayers(this.refs, true)
    this.render()
    await this.load()
  }

  private async load(): Promise<void> {
    try {
      this.data = await loadStore()
    } catch {
      V.renderPastError(this.refs, () => void this.load())
      return
    }
    sound.setMuted(this.data.muted)
    this.player = (this.data.player as PlayerState | null) ?? initialPlayerState()
    this.renderHistory()
    const ip = this.data.inProgress
    if (ip && this.resume(ip)) return
    this.newGame()
  }

  // ---------- setup ----------
  private resume(ip: InProgressGame): boolean {
    try {
      this.g = new GameState(ip.fenStart, ip.uci)
    } catch {
      this.data.inProgress = null
      void saveInProgress(null)
      return false
    }
    if (this.g.outcome()) {
      this.data.inProgress = null
      void saveInProgress(null)
      return false
    }
    this.color = ip.playerColor
    this.gameId = ip.id
    this.startedAt = ip.startedAt
    this.botSkill = ip.botSkill
    this.botElo = eloForSkill(ip.botSkill)
    this.ratingBefore = ip.playerRatingBefore
    this.undos = ip.undosUsed
    this.hints = ip.hintsUsed
    this.easing = new EasingTracker()
    this.easingOn = ip.easingApplied
    this.losses = new Map(ip.losses.map((l, i) => [i, l] as [number, number]).filter(([, l]) => Number.isFinite(l)))
    this.flipped = this.color === 'b'
    this.afterSetup()
    return true
  }

  private newGame(): void {
    this.token++
    this.bot.cancel()
    this.closePromo?.()
    this.closePromo = null
    window.clearTimeout(this.nextTimer)
    this.replay = null
    const last = this.data.games[this.data.games.length - 1]
    this.color = last ? (last.playerColor === 'w' ? 'b' : 'w') : 'w'
    const choice = chooseBotSkill(this.player)
    this.botSkill = choice.skill
    this.botElo = choice.botElo
    this.ratingBefore = this.player.rating
    this.g = new GameState()
    this.gameId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    this.startedAt = new Date().toISOString()
    this.undos = 0
    this.hints = 0
    this.easing = new EasingTracker()
    this.easingOn = false
    this.losses = new Map()
    this.pending.clear()
    this.flipped = this.color === 'b'
    this.afterSetup()
  }

  private afterSetup(): void {
    this.sel = null
    this.targets.clear()
    this.hintSq = null
    this.focus = this.color === 'w' ? 'e2' : 'e7'
    V.setPlayers(this.refs, !this.flipped ? this.color === 'w' : this.color === 'b')
    this.phase = this.g.turn === this.color ? 'player' : 'bot'
    this.freshFrom = -1
    this.render()
    this.persistProgress()
    this.renderHistory()
    if (this.phase === 'bot') void this.botTurn()
    V.announce(this.refs, this.color === 'w' ? 'New game. You play white.' : 'New game. You play black.')
  }

  // ---------- rendering ----------
  private bottomIsYou(): boolean {
    return this.flipped ? this.color === 'b' : this.color === 'w'
  }

  private render(): void {
    const r = this.refs
    const rep = this.replay
    let pos: Position
    let last: [string, string] | null
    let san: string[]
    let cur: number
    if (rep) {
      const at = positionAt(rep.game.fenStart, rep.uci, rep.ply)
      pos = at.pos
      last = at.last
      san = rep.game.moves
      cur = rep.ply
    } else {
      pos = this.g.pos
      last = this.g.squares.length ? this.g.squares[this.g.squares.length - 1]! : null
      san = this.g.san
      cur = san.length
    }
    const checked = pos.inCheck() ? sqName(pos.kingSq[pos.side]!) : null
    V.renderBoard(r, {
      pos,
      flipped: this.flipped,
      last,
      checked,
      selected: rep ? null : this.sel,
      targets: rep ? new Map() : this.targets,
      hint: rep ? null : this.hintSq,
      mine: rep || this.phase !== 'player' ? null : this.color,
      focus: this.focus,
    })
    V.renderStrips(r, pos, this.flipped ? 'b' : 'w')
    V.setPlayers(r, this.flipped ? this.color === 'b' : this.color === 'w')
    r.board.dataset.busy = String(this.phase === 'bot')
    const live = !rep && this.phase !== 'over' && this.phase !== 'loading'
    const minPlies = this.color === 'w' ? 0 : 1
    const canUndo = live && this.g.plies - (this.phase === 'player' ? 2 : 1) >= minPlies
    V.setTools(r, MAX_UNDO - this.undos, MAX_HINT - this.hints, canUndo, live && this.phase === 'player')
    V.renderMoves(r, san, cur, !!rep, (ply) => this.seek(ply), this.freshFrom)
  }

  private renderHistory(): void {
    let w = 0
    let l = 0
    let d = 0
    for (const g of this.data.games) g.result === 'win' ? w++ : g.result === 'loss' ? l++ : d++
    V.renderTally(this.refs, w, l, d)
    V.renderPast(this.refs, this.data.games, this.replay?.game.id ?? null, (g) => this.enterReplay(g), this.freshGame)
    this.freshGame = null
  }

  // ---------- input ----------
  private wire(): void {
    this.refs.board.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('.sq') as HTMLElement | null
      if (!b) return
      this.focus = b.dataset.sq!
      this.onSquare(b.dataset.sq!)
    })
    this.refs.undoBtn.addEventListener('click', () => this.undo())
    this.refs.hintBtn.addEventListener('click', () => void this.hint())
    this.wireDrag()
    window.addEventListener('keydown', (e) => this.onKey(e))
  }

  private suppressClick = false

  /** Pointer drag: ghost follows the pointer (transform only), snaps on drop, glides back on an illegal drop. */
  private wireDrag(): void {
    const board = this.refs.board
    board.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.phase !== 'player' || this.replay || this.closePromo) return
      const sqEl = (e.target as HTMLElement).closest('.sq.mine') as HTMLElement | null
      const pieceEl = sqEl?.querySelector('.piece') as HTMLElement | null
      if (!sqEl || !pieceEl) return
      const from = sqEl.dataset.sq!
      const rect = pieceEl.getBoundingClientRect()
      const sx = e.clientX
      const sy = e.clientY
      let ghost: HTMLElement | null = null
      const move = (ev: PointerEvent): void => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
          if (this.sel !== from) this.select(from)
          ghost = pieceEl.cloneNode(true) as HTMLElement
          ghost.classList.add('drag-ghost')
          ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;z-index:30`
          document.body.appendChild(ghost)
          pieceEl.style.opacity = '0.25'
        }
        ghost.style.transform = `translate(${ev.clientX - sx}px,${ev.clientY - sy}px) scale(1.08)`
      }
      const end = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        if (!ghost) return
        this.suppressClick = true
        setTimeout(() => (this.suppressClick = false), 0)
        const g = ghost
        pieceEl.style.opacity = ''
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.sq') as HTMLElement | null
        const to = under?.dataset.sq
        if (ev.type === 'pointerup' && to && to !== from && this.targets.has(to)) {
          g.remove()
          this.focus = to
          this.tryMove(from, to)
          return
        }
        if (ev.type === 'pointerup' && to !== from) V.shake(this.refs)
        const back = g.animate([{ transform: g.style.transform }, { transform: 'translate(0,0) scale(1)' }], {
          duration: 140,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        })
        back.onfinish = () => g.remove()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    })
  }

  private onSquare(name: string): void {
    if (this.phase === 'over' && !this.replay) {
      this.newGame()
      return
    }
    if (this.replay || this.phase !== 'player' || this.closePromo) return
    const f = name.charCodeAt(0) - 97
    const rk = name.charCodeAt(1) - 49
    const p = this.g.pos.board[rk * 16 + f]!
    const own = p !== 0 && (p >> 3 === 0 ? 'w' : 'b') === this.color
    if (this.sel && this.targets.has(name)) {
      this.tryMove(this.sel, name)
      return
    }
    if (own) {
      this.select(name)
      return
    }
    const had = this.sel
    this.sel = null
    this.targets.clear()
    this.render()
    if (had) V.shake(this.refs)
  }

  private select(name: string): void {
    this.sel = name
    this.targets.clear()
    for (const m of this.g.legalMoves()) {
      if (sqName(mFrom(m)) === name) {
        const to = sqName(mTo(m))
        const tf = to.charCodeAt(0) - 97
        const tr = to.charCodeAt(1) - 49
        const isEp = (this.g.pos.board[(name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97)]! & 7) === 1 && to[0] !== name[0]
        this.targets.set(to, this.g.pos.board[tr * 16 + tf] !== 0 || isEp)
      }
    }
    this.render()
  }

  private tryMove(from: string, to: string): void {
    const promo = this.g.legalMoves().some((m) => sqName(mFrom(m)) === from && sqName(mTo(m)) === to && mPromo(m) !== 0)
    if (!promo) {
      this.commit(from + to)
      return
    }
    this.closePromo = V.showPromotion(
      this.refs,
      to,
      this.color,
      this.flipped,
      (t) => {
        this.closePromo?.()
        this.closePromo = null
        this.commit(from + to + t)
      },
      () => {
        this.closePromo?.()
        this.closePromo = null
        this.sel = null
        this.targets.clear()
        this.render()
      },
    )
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
    const k = e.key.toLowerCase()
    if (this.closePromo) return
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault()
      this.undo()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (k === 'm') {
      this.data.muted = !this.data.muted
      sound.setMuted(this.data.muted)
      void saveStore(this.data)
      V.toast(this.data.muted ? 'Sound off' : 'Sound on')
      return
    }
    if (k === 'f') {
      this.flipped = !this.flipped
      this.render()
      return
    }
    if (this.replay) {
      if (k === 'escape') this.exitReplay()
      else if (k === 'arrowleft') this.seek(this.replay.ply - 1)
      else if (k === 'arrowright') this.seek(this.replay.ply + 1)
      else if (k === 'home') this.seek(0)
      else if (k === 'end') this.seek(this.replay.uci.length)
      else return
      e.preventDefault()
      return
    }
    if (this.phase === 'over') {
      this.newGame()
      return
    }
    if (this.phase === 'loading') return
    if (k === 'n') {
      this.requestNew()
      return
    }
    if (k === 'h') {
      void this.hint()
      return
    }
    if (k === 'escape') {
      this.sel = null
      this.targets.clear()
      this.render()
      return
    }
    if (k.startsWith('arrow')) {
      const f = this.focus.charCodeAt(0) - 97
      const r = this.focus.charCodeAt(1) - 49
      const s = this.flipped ? -1 : 1
      const nf = Math.max(0, Math.min(7, f + (k === 'arrowright' ? s : k === 'arrowleft' ? -s : 0)))
      const nr = Math.max(0, Math.min(7, r + (k === 'arrowup' ? s : k === 'arrowdown' ? -s : 0)))
      this.focus = String.fromCharCode(97 + nf) + (nr + 1)
      this.render()
      this.refs.squares.get(this.focus)?.focus()
      e.preventDefault()
    }
  }

  private requestNew(): void {
    const myMoves = this.color === 'w' ? this.g.plies >= 1 : this.g.plies >= 2
    if (!myMoves) {
      this.newGame()
      return
    }
    if (Date.now() - this.resignArmed < 2500) {
      this.resignArmed = 0
      void this.finish({ termination: 'resign', winner: this.color === 'w' ? 'b' : 'w' }, true)
      return
    }
    this.resignArmed = Date.now()
    V.toast('Press N again to resign and start a new game', 'info', 2500)
  }

  // ---------- moves ----------
  private persistProgress(): void {
    if (this.phase === 'over') return
    const ip: InProgressGame = {
      id: this.gameId,
      startedAt: this.startedAt,
      playerColor: this.color,
      fenStart: this.g.fenStart,
      moves: this.g.san.slice(),
      uci: this.g.uci.slice(),
      botSkill: this.botSkill,
      playerRatingBefore: this.ratingBefore,
      undosUsed: this.undos,
      hintsUsed: this.hints,
      easingApplied: this.easingOn || this.easing.easingApplied,
      losses: [...this.losses.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]),
    }
    this.data.inProgress = ip
    void saveInProgress(ip)
  }

  private cue(san: string): sound.Cue {
    return san.includes('#') || san.includes('+') ? 'check' : san.startsWith('O-O') ? 'castle' : san.includes('x') ? 'capture' : 'move'
  }

  /** Apply a UCI move to the live game with animation and sound. */
  private apply(uci: string, byPlayer: boolean): boolean {
    const pos = this.g.pos
    const from = uci.slice(0, 2)
    const to = uci.slice(2, 4)
    const code = (sq: string): string => {
      const p = pos.board[(sq.charCodeAt(1) - 49) * 16 + (sq.charCodeAt(0) - 97)]!
      return p ? (p >> 3 === 0 ? 'w' : 'b') + 'pnbrqk'[(p & 7) - 1] : ''
    }
    const mover = code(from)
    let cap: { square: string; code: string } | null = code(to) ? { square: to, code: code(to) } : null
    const slides: [string, string][] = [[from, to]]
    if (mover[1] === 'p' && from[0] !== to[0] && !cap) cap = { square: to, code: (mover[0] === 'w' ? 'b' : 'w') + 'p' }
    if (mover[1] === 'k' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
      const rank = from[1]
      slides.push(to[0] === 'g' ? ['h' + rank, 'f' + rank] : ['a' + rank, 'd' + rank])
    }
    const fenBefore = pos.toFen()
    const ply = this.g.plies
    if (!this.g.play(uci)) return false
    const san = this.g.san[this.g.san.length - 1]!
    this.sel = null
    this.targets.clear()
    this.hintSq = null
    this.freshFrom = this.g.san.length - 1
    if (!this.replay) {
      this.render()
      V.animateMoves(this.refs, slides, cap)
    }
    sound.play(this.cue(san))
    V.announce(this.refs, `${byPlayer ? 'You' : 'Bot'} played ${san}`)
    if (byPlayer) this.analyse(ply, fenBefore, uci)
    return true
  }

  private analyse(ply: number, fenBefore: string, uci: string): void {
    const fenAfter = this.g.pos.toFen()
    const job = (async () => {
      try {
        const best = await this.analyst.evaluate(fenBefore, ANALYSIS_DEPTH)
        const after = await this.analyst.evaluate(fenAfter, ANALYSIS_DEPTH - 1)
        const loss = cpLoss(best.scoreCp, -after.scoreCp)
        if (this.g.uci[ply] === uci && Number.isFinite(loss)) this.losses.set(ply, loss)
      } catch {
        /* cancelled or worker restarted: skip this move */
      }
    })()
    this.pending.add(job)
    void job.finally(() => this.pending.delete(job))
  }

  private commit(uci: string): void {
    if (!this.apply(uci, true)) return
    this.persistProgress()
    const out = this.g.outcome()
    if (out) {
      void this.finish(out, false)
      return
    }
    this.phase = 'bot'
    this.render()
    void this.botTurn()
  }

  private async botTurn(): Promise<void> {
    const token = ++this.token
    this.phase = 'bot'
    this.render()
    V.setThinking(this.refs, true, !this.bottomIsYou())
    const lvl = levelFor(this.botSkill)
    const t0 = performance.now()
    let uci: string | null = null
    for (let attempt = 0; attempt < 2 && uci === null; attempt++) {
      try {
        const res = await this.bot.move(this.g.fenStart, this.g.uci.slice(), this.botSkill, {
          easing: this.easingOn,
          standardStart: true,
        })
        if (token !== this.token) return
        uci = res.move
        const st = this.easing.observe(-res.evalCp, this.g.plies)
        this.easingOn = this.easingOn || st.easingApplied
      } catch (err) {
        if (token !== this.token) return
        if ((err as Error).message !== 'cancelled') V.toast('Bot restarted', 'error')
      }
    }
    if (token !== this.token) return
    if (uci === null) {
      const moves = this.g.legalMoves()
      uci = moves.length ? this.g.pos.moveToUci(moves[Math.floor(Math.random() * moves.length)]!) : null
    }
    if (uci === null) return
    const want = lvl.thinkMin + Math.random() * (lvl.thinkMax - lvl.thinkMin)
    const wait = Math.min(want, BOT_BUDGET_MS) - (performance.now() - t0)
    if (wait > 0) await sleep(wait)
    if (token !== this.token) return
    V.setThinking(this.refs, false, true)
    if (!this.apply(uci, false)) return
    const out = this.g.outcome()
    if (out) {
      void this.finish(out, false)
      return
    }
    this.phase = 'player'
    this.persistProgress()
    this.render()
  }

  // ---------- undo and hint ----------
  private undo(): void {
    if (this.replay || this.phase === 'over' || this.phase === 'loading') return
    const minPlies = this.color === 'w' ? 0 : 1
    const mine = this.phase === 'player' ? 2 : 1
    if (this.g.plies - mine < minPlies || this.g.plies < mine) {
      V.shake(this.refs)
      return
    }
    if (this.undos >= MAX_UNDO) {
      V.shake(this.refs)
      return
    }
    this.token++
    this.bot.cancel()
    V.setThinking(this.refs, false, true)
    this.g.undo(mine)
    for (const k of [...this.losses.keys()]) if (k >= this.g.plies) this.losses.delete(k)
    this.undos++
    this.sel = null
    this.targets.clear()
    this.hintSq = null
    this.freshFrom = -1
    this.phase = 'player'
    this.render()
    this.persistProgress()
    V.announce(this.refs, `Move taken back. ${MAX_UNDO - this.undos} undos left.`)
  }

  private async hint(): Promise<void> {
    if (this.replay || this.phase !== 'player') return
    if (this.hints >= MAX_HINT) {
      V.shake(this.refs)
      V.toast('No hints left in this game')
      return
    }
    this.hints++
    const token = this.token
    try {
      const res = await this.hinter.evaluate(this.g.pos.toFen(), 5)
      if (token !== this.token || this.phase !== 'player') return
      this.hintSq = [res.move.slice(0, 2), res.move.slice(2, 4)]
      this.render()
      window.clearTimeout(this.hintTimer)
      this.hintTimer = window.setTimeout(() => {
        this.hintSq = null
        this.render()
      }, 4000)
      this.persistProgress()
    } catch {
      this.hints--
    }
  }

  // ---------- end of game ----------
  private async finish(out: Outcome, resigned: boolean): Promise<void> {
    this.token++
    this.bot.cancel()
    this.phase = 'over'
    V.setThinking(this.refs, false, true)
    const kind: 'win' | 'loss' | 'draw' = out.winner === null ? 'draw' : out.winner === this.color ? 'win' : 'loss'
    if (!resigned) {
      this.render()
      sound.play(kind === 'win' ? 'win' : kind === 'loss' ? 'lose' : 'end')
      const reason: Record<string, string> = {
        checkmate: 'Checkmate',
        stalemate: 'Stalemate',
        threefold: 'Same position three times',
        fifty: 'Fifty moves without progress',
        insufficient: 'Not enough pieces to win',
        resign: 'Resigned',
      }
      V.showBanner(this.refs, kind, kind === 'win' ? 'You won' : kind === 'loss' ? 'You lost' : 'Draw', reason[out.termination]!)
      V.announce(this.refs, `${kind === 'win' ? 'You won' : kind === 'loss' ? 'You lost' : 'Draw'}. ${reason[out.termination]}.`)
    }
    // Let background analysis finish (bounded), then update the hidden rating.
    await Promise.race([Promise.allSettled([...this.pending]), sleep(4000)])
    const losses = [...this.losses.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1])
    const sum = summarize(losses)
    const res = updateAfterGame(this.player, {
      result: kind === 'win' ? 1 : kind === 'draw' ? 0.5 : 0,
      acpl: sum.acpl,
      blunders: sum.blunders,
      plies: this.g.plies,
      hintsUsed: this.hints,
      botElo: this.botElo,
      endedAt: Date.now(),
    })
    this.player = res.state
    const rec: GameRecord = {
      id: this.gameId,
      startedAt: this.startedAt,
      playerColor: this.color,
      result: kind,
      termination: out.termination,
      moves: this.g.san.slice(),
      fenStart: this.g.fenStart,
      botSkill: this.botSkill,
      playerRatingBefore: this.ratingBefore,
      playerRatingAfter: res.state.rating,
      acpl: sum.acpl,
      easingApplied: this.easingOn || this.easing.easingApplied,
      hintsUsed: this.hints,
    }
    this.data.games.push(rec)
    if (this.data.games.length > MAX_GAMES) this.data.games.splice(0, this.data.games.length - MAX_GAMES)
    this.data.player = this.player
    this.data.inProgress = null
    this.freshGame = rec.id
    this.renderHistory()
    try {
      await saveStore(this.data)
    } catch {
      V.toast("Couldn't save this game", 'error')
    }
    if (resigned) {
      this.newGame()
      V.toast('Game saved as a loss')
      return
    }
    window.clearTimeout(this.nextTimer)
    this.nextTimer = window.setTimeout(() => {
      if (this.phase === 'over' && !this.replay) V.setNextPill(this.refs, true)
    }, 2400)
  }

  // ---------- replay ----------
  private enterReplay(g: GameRecord): void {
    this.closePromo?.()
    this.closePromo = null
    const uci = uciFromSan(g.fenStart, g.moves)
    this.replay = { game: g, uci, ply: uci.length }
    this.flipped = g.playerColor === 'b'
    this.render()
    this.renderHistory()
    this.refs.past.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }

  private seek(ply: number): void {
    if (!this.replay) return
    this.replay.ply = Math.max(0, Math.min(this.replay.uci.length, ply))
    this.render()
    const san = this.replay.game.moves[this.replay.ply - 1]
    if (san) sound.play(this.cue(san))
    if (san) V.announce(this.refs, san)
  }

  private exitReplay(): void {
    this.replay = null
    this.flipped = this.color === 'b'
    this.render()
    this.renderHistory()
    if (this.phase === 'over') V.setNextPill(this.refs, true)
  }
}
