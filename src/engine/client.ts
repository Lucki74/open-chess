// Main-thread wrapper around the engine worker. Cancel = terminate + respawn.
import type { EvalResponse, MoveResponse, WorkerRequest, WorkerResponse } from './engine.worker'

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }

export class EngineClient {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  /** called when the worker crashed and was respawned */
  onRestart: (() => void) | null = null

  constructor(private factory: () => Worker = () => new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })) {}

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = this.factory()
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      if (e.data.type === 'error') p.reject(new Error(e.data.message))
      else p.resolve(e.data)
    }
    w.onerror = (ev) => {
      ev.preventDefault?.()
      this.fail(new Error('engine crashed'))
      this.onRestart?.()
    }
    this.worker = w
    return w
  }

  private fail(err: Error): void {
    this.worker?.terminate()
    this.worker = null
    const all = [...this.pending.values()]
    this.pending.clear()
    for (const p of all) p.reject(err)
  }

  private call(req: WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never): Promise<WorkerResponse> {
    const id = this.nextId++
    const w = this.ensure()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      w.postMessage({ ...req, id })
    })
  }

  move(fenStart: string, uciHistory: string[], skill: number, opts: { easing?: boolean; standardStart?: boolean } = {}): Promise<MoveResponse> {
    return this.call({ type: 'move', fen: fenStart, moveHistory: uciHistory, skill, ...opts }) as Promise<MoveResponse>
  }

  evaluate(fen: string, depth: number): Promise<EvalResponse> {
    return this.call({ type: 'evaluate', fen, depth }) as Promise<EvalResponse>
  }

  /** Abort anything running; pending promises reject with Error('cancelled'). */
  cancel(): void {
    this.fail(new Error('cancelled'))
  }

  dispose(): void {
    this.cancel()
  }
}
