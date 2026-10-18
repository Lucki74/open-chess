import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  MAX_GAMES,
  SCHEMA_VERSION,
  defaultStore,
  type Color,
  type GameRecord,
  type InProgressGame,
  type StoreData,
} from '../src/store/types'

// Pure Node module: no electron import, so vitest can drive it with a temp dir.

export const STORE_FILE = 'history.json'
export const TMP_SUFFIX = '.tmp'
export const CORRUPT_FILE = 'history.corrupt.json'

export class InvalidStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidStoreError'
  }
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
const isNumArr = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum)
const isColor = (v: unknown): v is Color => v === 'w' || v === 'b'

function need(ok: boolean, what: string): asserts ok {
  if (!ok) throw new InvalidStoreError(`invalid ${what}`)
}

function parseGame(v: unknown): GameRecord {
  need(isObj(v), 'game')
  const g = v
  need(isStr(g.id), 'game.id')
  need(isStr(g.startedAt), 'game.startedAt')
  need(isColor(g.playerColor), 'game.playerColor')
  need(g.result === 'win' || g.result === 'loss' || g.result === 'draw', 'game.result')
  need(isStr(g.termination), 'game.termination')
  need(isStrArr(g.moves), 'game.moves')
  need(isStr(g.fenStart), 'game.fenStart')
  need(isNum(g.botSkill), 'game.botSkill')
  need(isNum(g.playerRatingBefore), 'game.playerRatingBefore')
  need(isNum(g.playerRatingAfter), 'game.playerRatingAfter')
  need(g.acpl === null || isNum(g.acpl), 'game.acpl')
  need(isBool(g.easingApplied), 'game.easingApplied')
  need(isNum(g.hintsUsed), 'game.hintsUsed')
  return {
    id: g.id,
    startedAt: g.startedAt,
    playerColor: g.playerColor,
    result: g.result,
    termination: g.termination,
    moves: g.moves,
    fenStart: g.fenStart,
    botSkill: g.botSkill,
    playerRatingBefore: g.playerRatingBefore,
    playerRatingAfter: g.playerRatingAfter,
    acpl: g.acpl,
    easingApplied: g.easingApplied,
    hintsUsed: g.hintsUsed,
  }
}

function parseInProgress(v: unknown): InProgressGame {
  need(isObj(v), 'inProgress')
  const g = v
  need(isStr(g.id), 'inProgress.id')
  need(isStr(g.startedAt), 'inProgress.startedAt')
  need(isColor(g.playerColor), 'inProgress.playerColor')
  need(isStr(g.fenStart), 'inProgress.fenStart')
  need(isStrArr(g.moves), 'inProgress.moves')
  need(isStrArr(g.uci), 'inProgress.uci')
  need(isNum(g.botSkill), 'inProgress.botSkill')
  need(isNum(g.playerRatingBefore), 'inProgress.playerRatingBefore')
  need(isNum(g.undosUsed), 'inProgress.undosUsed')
  need(isNum(g.hintsUsed), 'inProgress.hintsUsed')
  need(isBool(g.easingApplied), 'inProgress.easingApplied')
  need(isNumArr(g.losses), 'inProgress.losses')
  return {
    id: g.id,
    startedAt: g.startedAt,
    playerColor: g.playerColor,
    fenStart: g.fenStart,
    moves: g.moves,
    uci: g.uci,
    botSkill: g.botSkill,
    playerRatingBefore: g.playerRatingBefore,
    undosUsed: g.undosUsed,
    hintsUsed: g.hintsUsed,
    easingApplied: g.easingApplied,
    losses: g.losses,
  }
}

/** Version switch. Only v1 exists. Unknown or future versions throw InvalidStoreError. */
export function migrate(raw: unknown): StoreData {
  need(isObj(raw), 'store root')
  switch (raw.version) {
    case 1:
      return parseV1(raw)
    default:
      throw new InvalidStoreError(`unsupported store version ${String(raw.version)}`)
  }
}

function parseV1(raw: Obj): StoreData {
  need(Array.isArray(raw.games), 'games')
  const games = (raw.games as unknown[]).map(parseGame)
  const inProgress = raw.inProgress === null || raw.inProgress === undefined ? null : parseInProgress(raw.inProgress)
  need(isBool(raw.muted), 'muted')
  return sanitize({
    version: SCHEMA_VERSION,
    games,
    player: raw.player === undefined ? null : raw.player,
    inProgress,
    muted: raw.muted,
  })
}

/** Keeps the newest MAX_GAMES. Games are stored oldest first. */
export function sanitize(data: StoreData): StoreData {
  if (data.games.length <= MAX_GAMES) return data
  return { ...data, games: data.games.slice(-MAX_GAMES) }
}

export interface Storage {
  readonly file: string
  load(): Promise<StoreData>
  save(data: unknown): Promise<void>
  saveInProgress(game: InProgressGame | null): Promise<void>
  /** Resolves once every queued read or write has finished. */
  drain(): Promise<void>
}

export function createStorage(dir: string): Storage {
  const file = path.join(dir, STORE_FILE)
  const tmp = file + TMP_SUFFIX
  const corrupt = path.join(dir, CORRUPT_FILE)

  // All reads and writes go through one queue so read-modify-write stays ordered.
  let chain: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task)
    chain = run.catch(() => undefined)
    return run
  }

  async function quarantine(): Promise<void> {
    // rename replaces an older history.corrupt.json on both POSIX and Windows.
    await fs.rename(file, corrupt).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
  }

  async function readStore(): Promise<StoreData> {
    let text: string
    try {
      text = await fs.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultStore()
      throw err
    }
    try {
      return migrate(JSON.parse(text))
    } catch (err) {
      if (err instanceof SyntaxError || err instanceof InvalidStoreError) {
        await quarantine()
        return defaultStore()
      }
      throw err
    }
  }

  async function writeAtomic(data: StoreData): Promise<void> {
    const json = JSON.stringify(sanitize(data))
    await fs.mkdir(dir, { recursive: true })
    const fh = await fs.open(tmp, 'w')
    try {
      await fh.writeFile(json, 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    // Windows can briefly lock the target (AV, indexer). Retry the rename a few times.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, file)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY')) throw err
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
      }
    }
  }

  return {
    file,
    load: () => enqueue(readStore),
    save: (data) =>
      enqueue(async () => {
        // Validate before touching disk. Invalid input throws and leaves the old file alone.
        const valid = migrate(data)
        await writeAtomic(valid)
      }),
    saveInProgress: (game) =>
      enqueue(async () => {
        const current = await readStore()
        await writeAtomic({ ...current, inProgress: game ? parseInProgress(game) : null })
      }),
    drain: () => enqueue(async () => undefined),
  }
}
