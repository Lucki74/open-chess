// Engine worker: one request at a time. Cancelling is done by the client terminating the worker.
import { Position, perft as perftCount } from './board'
import { Bot } from './bot'
import { MATE, Searcher } from './search'

export interface MoveRequest {
  type: 'move'
  id: number
  fen: string
  skill: number
  moveHistory: string[]
  easing?: boolean
  standardStart?: boolean
}
export interface EvalRequest {
  type: 'evaluate'
  id: number
  fen: string
  depth: number
}
export interface PerftRequest {
  type: 'perft'
  id: number
  fen: string
  depth: number
}
export type WorkerRequest = MoveRequest | EvalRequest | PerftRequest

export interface MoveResponse {
  type: 'move'
  id: number
  move: string
  evalCp: number
  depth: number
  nodes: number
  timeMs: number
  fromBook: boolean
}
export interface EvalResponse {
  type: 'evaluate'
  id: number
  move: string
  scoreCp: number
  depth: number
}
export interface PerftResponse {
  type: 'perft'
  id: number
  nodes: number
  timeMs: number
}
export interface ErrorResponse {
  type: 'error'
  id: number
  message: string
}
export type WorkerResponse = MoveResponse | EvalResponse | PerftResponse | ErrorResponse

const bot = new Bot(18)
const analyser = new Searcher(18)

function handle(req: WorkerRequest): WorkerResponse {
  const pos = new Position(req.fen)
  if (req.type === 'move') {
    // fen is the game start position; moveHistory replays to the current one
    for (const u of req.moveHistory) {
      const m = pos.parseUci(u)
      if (m < 0) throw new Error(`bad move in history: ${u}`)
      pos.makeMove(m)
    }
    const r = bot.choose(pos, req.skill, {
      uciHistory: req.moveHistory,
      standardStart: req.standardStart ?? true,
      easing: req.easing,
    })
    if (!r) throw new Error('no legal moves')
    return {
      type: 'move',
      id: req.id,
      move: pos.moveToUci(r.move),
      evalCp: r.evalCp,
      depth: r.depth,
      nodes: r.nodes,
      timeMs: r.timeMs,
      fromBook: r.fromBook,
    }
  }
  if (req.type === 'evaluate') {
    const r = analyser.search(pos, {
      maxDepth: req.depth,
      maxNodes: 2e6,
      timeMs: 2500,
      qDepth: 12,
      nullMove: true,
      lmr: true,
    })
    return {
      type: 'evaluate',
      id: req.id,
      move: r.move ? pos.moveToUci(r.move) : '',
      scoreCp: Math.max(-MATE, Math.min(MATE, r.score)),
      depth: r.depth,
    }
  }
  const t0 = performance.now()
  const nodes = perftCount(pos, req.depth)
  return { type: 'perft', id: req.id, nodes, timeMs: performance.now() - t0 }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    ;(self as unknown as Worker).postMessage(handle(e.data))
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      type: 'error',
      id: e.data.id,
      message: err instanceof Error ? err.message : String(err),
    } satisfies ErrorResponse)
  }
}
