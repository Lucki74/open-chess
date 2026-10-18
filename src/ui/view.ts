// DOM view: builds the shell once, then updates it. No game rules in here.
import spriteText from '../../assets/pieces.svg?raw'
import type { Position } from '../engine/board'
import type { GameRecord } from '../store/types'
import { captured } from './game'

const SVGNS = 'http://www.w3.org/2000/svg'
const FILES = 'abcdefgh'
const NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
const TYPE_CHARS = ['', 'p', 'n', 'b', 'r', 'q', 'k']

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function pieceSvg(code: string, cls = 'piece'): SVGSVGElement {
  const s = document.createElementNS(SVGNS, 'svg')
  s.setAttribute('class', cls)
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('aria-hidden', 'true')
  const u = document.createElementNS(SVGNS, 'use')
  u.setAttribute('href', '#' + code)
  s.appendChild(u)
  return s
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const BOT_AVATAR = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#cdebc3"/><path d="M16 5.5c0-2 2-3.2 4-2.6-.2 2-1.8 3.4-4 2.6z" fill="#5e9e6b"/><circle cx="11.2" cy="14" r="2.2" fill="#1f4d32"/><circle cx="20.8" cy="14" r="2.2" fill="#1f4d32"/><path d="M10.5 19.5q5.5 5 11 0" stroke="#1f4d32" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`
const YOU_AVATAR = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#fff8e7"/><circle cx="16" cy="12.5" r="5" fill="#2f6b43"/><path d="M6.5 27c.8-5.6 4.8-8 9.5-8s8.7 2.4 9.5 8a16 16 0 0 1-19 0z" fill="#2f6b43"/></svg>`
const EMPTY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#wp" style="--white-fill:#cdebc3;--white-stroke:#5e9e6b"/></svg>`

export interface BoardModel {
  pos: Position
  flipped: boolean
  last: [string, string] | null
  checked: string | null
  selected: string | null
  targets: Map<string, boolean>
  hint: [string, string] | null
  /** side whose pieces get the pointer cursor */
  mine: 'w' | 'b' | null
  focus: string
}

export interface Refs {
  root: HTMLElement
  board: HTMLElement
  boardwrap: HTMLElement
  squares: Map<string, HTMLButtonElement>
  topPlayer: HTMLElement
  bottomPlayer: HTMLElement
  topStrip: HTMLElement
  bottomStrip: HTMLElement
  topStatus: HTMLElement
  bottomStatus: HTMLElement
  tally: HTMLElement
  moves: HTMLElement
  movesTitle: HTMLElement
  past: HTMLElement
  live: HTMLElement
  arrow: SVGSVGElement
  undoBtn: HTMLButtonElement
  hintBtn: HTMLButtonElement
}

export function build(root: HTMLElement): Refs {
  const holder = el('div')
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  holder.setAttribute('aria-hidden', 'true')
  holder.innerHTML = spriteText
  document.body.prepend(holder)

  root.textContent = ''
  const shell = el('div', 'shell')
  shell.appendChild(el('div', 'drag'))

  const stage = el('section', 'stage')
  const mkPlayer = (): { box: HTMLElement; strip: HTMLElement; status: HTMLElement } => {
    const box = el('div', 'player')
    const strip = el('div', 'strip')
    const status = el('div', 'status')
    box.append(el('div', 'avatar'), el('span', 'pname'), strip, status)
    return { box, strip, status }
  }
  const top = mkPlayer()
  const bottom = mkPlayer()
  const mkTool = (cls: string, label: string, icon: string): HTMLButtonElement => {
    const b = el('button', 'tool ' + cls)
    b.type = 'button'
    b.tabIndex = -1
    b.setAttribute('aria-label', label)
    b.title = label
    b.innerHTML = icon + '<span class="cnt"></span>'
    return b
  }
  const undoBtn = mkTool('undo', 'Undo your last move (Ctrl+Z)', UNDO_ICON)
  const hintBtn = mkTool('hint', 'Show a hint (H)', HINT_ICON)
  const tools = el('div', 'tools')
  tools.append(undoBtn, hintBtn)
  bottom.box.insertBefore(tools, bottom.status)
  const wrap = el('div', 'boardwrap')
  const board = el('div', 'board')
  board.setAttribute('role', 'grid')
  board.setAttribute('aria-label', 'Chess board')
  const squares = new Map<string, HTMLButtonElement>()
  for (let r = 0; r < 8; r++) {
    const row = el('div')
    row.setAttribute('role', 'row')
    row.style.display = 'contents'
    for (let f = 0; f < 8; f++) {
      const b = el('button', 'sq')
      b.type = 'button'
      b.tabIndex = -1
      b.setAttribute('role', 'gridcell')
      const name = FILES[f]! + (r + 1)
      b.dataset.sq = name
      b.dataset.dark = String((f + r) % 2 === 0)
      squares.set(name, b)
      row.appendChild(b)
    }
    board.appendChild(row)
  }
  const arrow = document.createElementNS(SVGNS, 'svg')
  arrow.setAttribute('class', 'hint-arrow')
  arrow.setAttribute('viewBox', '0 0 8 8')
  arrow.setAttribute('aria-hidden', 'true')
  wrap.append(board, arrow)
  const col = el('div', 'col')
  col.append(top.box, wrap, bottom.box)
  stage.appendChild(col)

  const panel = el('aside', 'panel')
  panel.setAttribute('aria-label', 'Game history')
  const tally = el('div', 'tally')
  const live = el('div', 'section live')
  const movesTitle = el('h3', undefined, 'Moves')
  const movesScroll = el('div', 'scroll')
  const moves = el('div', 'moves')
  movesScroll.appendChild(moves)
  live.append(movesTitle, movesScroll)
  const past = el('div', 'section past')
  panel.append(tally, live, past)

  const lr = el('div', 'sr')
  lr.setAttribute('role', 'status')
  lr.setAttribute('aria-live', 'polite')

  shell.append(stage, panel)
  root.append(shell, lr)
  return {
    root,
    board,
    boardwrap: wrap,
    squares,
    topPlayer: top.box,
    bottomPlayer: bottom.box,
    topStrip: top.strip,
    bottomStrip: bottom.strip,
    topStatus: top.status,
    bottomStatus: bottom.status,
    tally,
    moves,
    movesTitle,
    past,
    live: lr,
    arrow,
    undoBtn,
    hintBtn,
  }
}

const UNDO_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4.5 11.5 9 16M5 11.5h8.5a5 5 0 0 1 0 10H11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -3)"/></svg>`
const HINT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a6 6 0 0 0-3.4 10.9c.6.5.9 1.1.9 1.8v.3h5v-.3c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3.5zM9.8 19.5h4.4M10.5 21.5h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

export function setTools(r: Refs, undoLeft: number, hintLeft: number, canUndo: boolean, canHint: boolean): void {
  const set = (b: HTMLButtonElement, n: number, on: boolean): void => {
    b.disabled = !on
    b.querySelector('.cnt')!.textContent = String(n)
  }
  set(r.undoBtn, undoLeft, canUndo && undoLeft > 0)
  set(r.hintBtn, hintLeft, canHint && hintLeft > 0)
}

function drawArrow(r: Refs, hint: [string, string] | null, flipped: boolean): void {
  r.arrow.textContent = ''
  if (!hint) return
  const c = (n: string): [number, number] => {
    const f = n.charCodeAt(0) - 97
    const rk = n.charCodeAt(1) - 49
    return [(flipped ? 7 - f : f) + 0.5, (flipped ? rk : 7 - rk) + 0.5]
  }
  const [x1, y1] = c(hint[0])
  const [x2, y2] = c(hint[1])
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (!len) return
  const ux = dx / len
  const uy = dy / len
  const head = 0.55
  const sx = x1 + ux * 0.3
  const sy = y1 + uy * 0.3
  const bx = x2 - ux * head
  const by = y2 - uy * head
  const w = 0.17
  const nx = -uy
  const ny = ux
  const g = document.createElementNS(SVGNS, 'g')
  const line = document.createElementNS(SVGNS, 'line')
  for (const [k, v] of Object.entries({ x1: sx, y1: sy, x2: bx, y2: by, 'stroke-width': w * 2 })) line.setAttribute(k, String(v))
  line.setAttribute('stroke-linecap', 'round')
  const tip = document.createElementNS(SVGNS, 'polygon')
  tip.setAttribute(
    'points',
    `${x2},${y2} ${bx + nx * 0.34},${by + ny * 0.34} ${bx - nx * 0.34},${by - ny * 0.34}`,
  )
  g.append(line, tip)
  r.arrow.appendChild(g)
}

export function announce(r: Refs, text: string): void {
  r.live.textContent = ''
  window.setTimeout(() => (r.live.textContent = text), 30)
}

export function squareRect(r: Refs, name: string): DOMRect {
  return r.squares.get(name)!.getBoundingClientRect()
}

export function setPlayers(r: Refs, bottomIsYou: boolean): void {
  const set = (box: HTMLElement, you: boolean): void => {
    box.querySelector('.avatar')!.innerHTML = you ? YOU_AVATAR : BOT_AVATAR
    box.querySelector('.pname')!.textContent = you ? 'You' : 'Bot'
  }
  set(r.bottomPlayer, bottomIsYou)
  set(r.topPlayer, !bottomIsYou)
}

export function renderBoard(r: Refs, m: BoardModel): void {
  drawArrow(r, m.hint, m.flipped)
  // Display order: white at the bottom unless flipped.
  const order: string[] = []
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++) {
      const file = m.flipped ? 7 - col : col
      const rank = m.flipped ? row : 7 - row
      order.push(FILES[file]! + (rank + 1))
    }
  const bottomRank = m.flipped ? 8 : 1
  const leftFile = m.flipped ? 'h' : 'a'
  // Re-append rows in display order only when orientation changed.
  const key = String(m.flipped)
  if (r.board.dataset.flip !== key) {
    r.board.dataset.flip = key
    const rows = Array.from(r.board.children) as HTMLElement[]
    order.forEach((name, i) => rows[Math.floor(i / 8)]!.appendChild(r.squares.get(name)!))
  }
  for (const name of order) {
    const b = r.squares.get(name)!
    const f = name.charCodeAt(0) - 97
    const rk = name.charCodeAt(1) - 49
    const p = m.pos.board[rk * 16 + f]!
    const t = TYPE_CHARS[p & 7]!
    const colorCh = p ? ((p >> 3) === 0 ? 'w' : 'b') : ''
    const code = p ? colorCh + t : ''
    if (b.dataset.p !== code) {
      b.dataset.p = code
      b.querySelector('.piece')?.remove()
      if (p) b.appendChild(pieceSvg(code))
    }
    const cls = ['sq']
    if (m.last && (m.last[0] === name || m.last[1] === name)) cls.push('last')
    if (m.selected === name) cls.push('sel')
    if (m.checked === name) cls.push('check')
    if (m.hint && (m.hint[0] === name || m.hint[1] === name)) cls.push('hint')
    if (m.targets.has(name)) cls.push('target', ...(m.targets.get(name) ? ['cap'] : []))
    if (m.mine && code && code[0] === m.mine) cls.push('mine')
    b.className = cls.join(' ')
    b.tabIndex = name === m.focus ? 0 : -1
    b.setAttribute('aria-label', code ? `${name}, ${colorCh === 'w' ? 'white' : 'black'} ${NAMES[t]}` : `${name}, empty`)
    b.setAttribute('aria-selected', String(m.selected === name))
    b.querySelectorAll('.coord').forEach((c) => c.remove())
    if (name[0] === leftFile || name[1] === String(bottomRank)) {
      if (name[1] === String(bottomRank)) b.appendChild(el('span', 'coord file', name[0]))
      if (name[0] === leftFile) b.appendChild(el('span', 'coord rank', name[1]))
    }
  }
}

/** Slide pieces from old squares to their new ones, and shrink a captured piece. */
export function animateMoves(r: Refs, moves: [string, string][], capture: { square: string; code: string } | null): void {
  if (reducedMotion()) return
  for (const [from, to] of moves) {
    const piece = r.squares.get(to)?.querySelector('.piece') as SVGElement | null
    if (!piece) continue
    const a = squareRect(r, from)
    const b = squareRect(r, to)
    piece.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], {
      duration: 190,
      easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
    })
  }
  if (capture) {
    const host = r.squares.get(capture.square)!
    const ghost = pieceSvg(capture.code, 'ghost')
    host.appendChild(ghost)
    ghost.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.6)', opacity: 0 }], {
      duration: 140,
      easing: 'ease-out',
      fill: 'forwards',
    }).onfinish = () => ghost.remove()
  }
}

export function shake(r: Refs): void {
  if (reducedMotion()) return
  r.board.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }],
    { duration: 240, easing: 'ease-out' },
  )
}

export function renderStrips(r: Refs, pos: Position, bottomColor: 'w' | 'b'): void {
  const c = captured(pos)
  const fill = (strip: HTMLElement, color: 'w' | 'b'): void => {
    const mine = color === 'w' ? c.byWhite : c.byBlack
    const adv = color === 'w' ? c.diff : -c.diff
    const enemy = color === 'w' ? 'b' : 'w'
    strip.textContent = ''
    for (const t of mine) {
      const wrap = el('span', 'cp')
      wrap.appendChild(pieceSvg(enemy + t, 'cpi'))
      const svg = wrap.firstElementChild as SVGElement
      svg.removeAttribute('class')
      strip.appendChild(wrap)
    }
    if (adv > 0) strip.appendChild(el('span', 'adv', '+' + adv))
  }
  fill(r.bottomStrip, bottomColor)
  fill(r.topStrip, bottomColor === 'w' ? 'b' : 'w')
}

export function setThinking(r: Refs, on: boolean, topIsBot: boolean): void {
  r.topStatus.textContent = ''
  r.bottomStatus.textContent = ''
  if (!on) return
  const dots = el('span', 'dots')
  dots.setAttribute('role', 'img')
  dots.setAttribute('aria-label', 'Bot is thinking')
  dots.append(el('i'), el('i'), el('i'))
  ;(topIsBot ? r.topStatus : r.bottomStatus).appendChild(dots)
}

export function setNextPill(r: Refs, on: boolean): void {
  r.topStatus.textContent = ''
  r.bottomStatus.textContent = ''
  if (on) r.bottomStatus.appendChild(el('span', 'nextpill', 'Press any key for the next game'))
}

export function renderTally(r: Refs, w: number, l: number, d: number): void {
  r.tally.textContent = ''
  const mk = (cls: string, label: string, n: number): void => {
    const p = el('div', 'pill ' + cls)
    p.setAttribute('aria-label', `${n} ${label}`)
    p.append(el('b', undefined, String(n)), el('span', undefined, label))
    r.tally.appendChild(p)
  }
  mk('w', 'won', w)
  mk('l', 'lost', l)
  mk('d', 'drawn', d)
}

export function renderMoves(r: Refs, san: string[], current: number, replaying: boolean, onPick: (ply: number) => void, freshFrom = -1): void {
  r.moves.textContent = ''
  r.moves.classList.toggle('replaying', replaying)
  r.movesTitle.textContent = 'Moves'
  if (replaying) r.movesTitle.appendChild(el('span', 'replaytag', 'Replay'))
  if (!san.length) {
    r.moves.style.display = 'block'
    r.moves.appendChild(el('div', 'hintline', 'Make a move to start.'))
    return
  }
  r.moves.style.display = ''
  const rows = Math.ceil(san.length / 2)
  const keepFrom = Math.min(rows - 6, Math.max(0, Math.ceil(current / 2) - 1))
  for (let i = 0; i < san.length; i += 2) {
    const old = i / 2 < keepFrom ? ' old' : ''
    r.moves.appendChild(el('span', 'n' + old, String(i / 2 + 1) + '.'))
    for (let k = 0; k < 2; k++) {
      const idx = i + k
      if (idx >= san.length) {
        r.moves.appendChild(el('span', old.trim()))
        continue
      }
      const b = el('button', (idx + 1 === current ? 'cur' : '') + (idx >= freshFrom && freshFrom >= 0 ? ' fresh' : '') + old, san[idx])
      b.type = 'button'
      b.tabIndex = replaying ? 0 : -1
      if (idx + 1 === current) b.setAttribute('aria-current', 'true')
      b.addEventListener('click', () => replaying && onPick(idx + 1))
      r.moves.appendChild(b)
    }
  }
  const scroller = r.moves.parentElement!
  const cur = r.moves.querySelector('.cur') as HTMLElement | null
  if (replaying && cur) cur.scrollIntoView({ block: 'nearest' })
  else scroller.scrollTop = scroller.scrollHeight
}

function dateLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay ? `Today, ${time}` : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function renderPast(r: Refs, games: GameRecord[], activeId: string | null, onPick: (g: GameRecord) => void, freshId: string | null): void {
  r.past.textContent = ''
  r.past.appendChild(el('h3', undefined, 'Past games'))
  const scroll = el('div', 'scroll')
  if (!games.length) {
    const e = el('div', 'empty')
    e.innerHTML = EMPTY_ICON
    e.appendChild(el('span', undefined, 'Your games will show up here'))
    scroll.appendChild(e)
  } else {
    const list = el('div', 'games')
    for (const g of [...games].reverse()) {
      const b = el('button', 'game' + (g.id === freshId ? ' fresh' : ''))
      b.type = 'button'
      const words = g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Drew'
      const plies = g.moves.length
      b.setAttribute('aria-label', `${words} as ${g.playerColor === 'w' ? 'white' : 'black'}, ${Math.ceil(plies / 2)} moves, ${dateLabel(g.startedAt)}. Replay`)
      if (g.id === activeId) b.setAttribute('aria-current', 'true')
      b.append(
        el('span', 'cdot ' + g.playerColor),
        el('span', 'when', dateLabel(g.startedAt)),
        el('span', 'cnt', `${Math.ceil(plies / 2)} moves`),
        el('span', 'chip ' + g.result, g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'),
      )
      b.addEventListener('click', () => onPick(g))
      list.appendChild(b)
    }
    scroll.appendChild(list)
  }
  r.past.appendChild(scroll)
}

export function renderPastLoading(r: Refs): void {
  r.past.textContent = ''
  r.past.appendChild(el('h3', undefined, 'Past games'))
  const scroll = el('div', 'scroll')
  scroll.setAttribute('aria-busy', 'true')
  for (let i = 0; i < 4; i++) {
    scroll.appendChild(el('div', 'skel'))
    scroll.lastElementChild!.setAttribute('style', 'margin-bottom:4px')
  }
  r.past.appendChild(scroll)
}

export function renderPastError(r: Refs, onRetry: () => void): void {
  r.past.textContent = ''
  r.past.appendChild(el('h3', undefined, 'Past games'))
  const e = el('div', 'empty')
  e.appendChild(el('span', undefined, "Couldn't read your games."))
  const b = el('button', 'retry', 'Try again')
  b.type = 'button'
  b.addEventListener('click', onRetry)
  e.appendChild(b)
  r.past.appendChild(e)
}

let toastTimer = 0
export function toast(text: string, kind: 'info' | 'error' = 'info', ms = 2400): void {
  document.querySelector('.toast')?.remove()
  window.clearTimeout(toastTimer)
  const t = el('div', 'toast' + (kind === 'error' ? ' error' : ''), text)
  t.setAttribute('role', 'status')
  document.body.appendChild(t)
  toastTimer = window.setTimeout(() => {
    t.classList.add('out')
    window.setTimeout(() => t.remove(), 220)
  }, ms)
}

export function showBanner(r: Refs, kind: 'win' | 'loss' | 'draw', title: string, sub: string): HTMLElement {
  const b = el('div', 'banner')
  b.dataset.kind = kind
  const card = el('div', 'card')
  card.append(el('h2', undefined, title), el('p', undefined, sub))
  b.appendChild(card)
  r.boardwrap.appendChild(b)
  window.setTimeout(() => card.classList.add('out'), 2000)
  window.setTimeout(() => b.remove(), 2400)
  return b
}

export function showPromotion(r: Refs, square: string, color: 'w' | 'b', flipped: boolean, onPick: (t: 'q' | 'r' | 'b' | 'n') => void, onCancel: () => void): () => void {
  const target = r.squares.get(square)!
  const wrapRect = r.boardwrap.getBoundingClientRect()
  const sq = target.getBoundingClientRect()
  const box = el('div', 'promo')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Choose a piece')
  const size = sq.width
  box.style.width = size + 8 + 'px'
  box.style.left = sq.left - wrapRect.left - 4 + 'px'
  const down = (square[1] === '8') !== flipped
  const list: ('q' | 'n' | 'r' | 'b')[] = ['q', 'n', 'r', 'b']
  box.style.top = (down ? sq.top - wrapRect.top - 4 : sq.bottom - wrapRect.top - size * 4 - 4) + 'px'
  for (const t of list) {
    const b = el('button')
    b.type = 'button'
    b.style.height = size + 'px'
    b.setAttribute('aria-label', NAMES[t]!)
    b.appendChild(pieceSvg(color + t))
    b.firstElementChild!.removeAttribute('class')
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      onPick(t)
    })
    box.appendChild(b)
  }
  const close = (): void => box.remove()
  r.boardwrap.appendChild(box)
  ;(box.querySelector('button') as HTMLElement).focus()
  box.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase()
    if (k === 'escape') {
      e.stopPropagation()
      onCancel()
    } else if (k === 'q' || k === 'r' || k === 'b' || k === 'n') {
      e.stopPropagation()
      onPick(k)
    }
  })
  return close
}
