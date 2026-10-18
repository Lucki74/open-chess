import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStorage, migrate, InvalidStoreError } from '../electron/storage'
import { MAX_GAMES, SCHEMA_VERSION, defaultStore, type GameRecord, type StoreData } from '../src/store/types'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chess-store-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const game = (i: number): GameRecord => ({
  id: `g${i}`,
  startedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  playerColor: i % 2 === 0 ? 'w' : 'b',
  result: 'win',
  termination: 'checkmate',
  moves: ['e4', 'e5', 'Nf3'],
  fenStart: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  botSkill: 800,
  playerRatingBefore: 1000,
  playerRatingAfter: 1012,
  acpl: 35.5,
  easingApplied: false,
  hintsUsed: 1,
})

const sample = (): StoreData => ({
  version: SCHEMA_VERSION,
  games: [game(1), game(2)],
  player: { rating: 1012, deviation: 300 },
  inProgress: {
    id: 'live',
    startedAt: '2026-01-02T00:00:00.000Z',
    playerColor: 'w',
    fenStart: 'start',
    moves: ['d4'],
    uci: ['d2d4'],
    botSkill: 900,
    playerRatingBefore: 1012,
    undosUsed: 0,
    hintsUsed: 0,
    easingApplied: true,
    losses: [12, 0],
  },
  muted: true,
})

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  )

describe('store round trip and defaults', () => {
  it('round-trips the full store', async () => {
    const s = createStorage(dir)
    await s.save(sample())
    expect(await s.load()).toEqual(sample())
  })

  it('returns defaults when the file is missing', async () => {
    const s = createStorage(dir)
    expect(await s.load()).toEqual(defaultStore())
    expect(await exists(s.file)).toBe(false)
  })

  it('saveInProgress only touches the in-progress slot', async () => {
    const s = createStorage(dir)
    await s.save(sample())
    const next = { ...sample().inProgress!, moves: ['d4', 'd5'], uci: ['d2d4', 'd7d5'] }
    await s.saveInProgress(next)
    const loaded = await s.load()
    expect(loaded.inProgress).toEqual(next)
    expect(loaded.games).toEqual(sample().games)
    await s.saveInProgress(null)
    expect((await s.load()).inProgress).toBeNull()
  })

  it('rejects invalid data without touching the existing file', async () => {
    const s = createStorage(dir)
    await s.save(sample())
    await expect(s.save({ ...sample(), muted: 'yes' })).rejects.toBeInstanceOf(InvalidStoreError)
    expect(await s.load()).toEqual(sample())
  })
})

describe('corruption handling', () => {
  it('backs up a corrupted file as history.corrupt.json and starts fresh', async () => {
    const s = createStorage(dir)
    await fs.writeFile(s.file, '{"version":1,"games":[', 'utf8')
    expect(await s.load()).toEqual(defaultStore())
    expect(await exists(s.file)).toBe(false)
    const backup = await fs.readFile(path.join(dir, 'history.corrupt.json'), 'utf8')
    expect(backup).toBe('{"version":1,"games":[')
  })

  it('overwrites an older backup on a second corruption', async () => {
    const s = createStorage(dir)
    await fs.writeFile(s.file, 'first garbage', 'utf8')
    await s.load()
    await fs.writeFile(s.file, 'second garbage', 'utf8')
    await s.load()
    expect(await fs.readFile(path.join(dir, 'history.corrupt.json'), 'utf8')).toBe('second garbage')
  })

  it('treats wrong shape as corrupt', async () => {
    const s = createStorage(dir)
    await fs.writeFile(s.file, JSON.stringify({ version: 1, games: 'nope', muted: false }), 'utf8')
    expect(await s.load()).toEqual(defaultStore())
    expect(await exists(path.join(dir, 'history.corrupt.json'))).toBe(true)
  })
})

describe('atomic write', () => {
  it('leaves no .tmp file after a successful save', async () => {
    const s = createStorage(dir)
    await s.save(sample())
    expect(await exists(s.file + '.tmp')).toBe(false)
    expect(await exists(s.file)).toBe(true)
  })

  it('never loads a leftover truncated .tmp file', async () => {
    const s = createStorage(dir)
    await s.save(sample())
    // Simulate a crash mid-write: a partial temp file next to the good file.
    await fs.writeFile(s.file + '.tmp', '{"version":1,"games":[{"id":"half', 'utf8')
    expect(await s.load()).toEqual(sample())
  })

  it('never loads a leftover .tmp even when it is complete JSON', async () => {
    const s = createStorage(dir)
    await fs.writeFile(s.file + '.tmp', JSON.stringify(sample()), 'utf8')
    expect(await s.load()).toEqual(defaultStore())
    expect(await exists(s.file + '.tmp')).toBe(true)
  })
})

describe('migration and versions', () => {
  it('migrate accepts v1', () => {
    expect(migrate(sample())).toEqual(sample())
  })

  it('migrate rejects an unknown future version', () => {
    expect(() => migrate({ ...sample(), version: 2 })).toThrow(InvalidStoreError)
    expect(() => migrate({ ...sample(), version: 0 })).toThrow(InvalidStoreError)
  })

  it('migrate rejects a missing version', () => {
    const { version: _v, ...rest } = sample()
    expect(() => migrate(rest)).toThrow(InvalidStoreError)
  })

  it('a future-version file is backed up and replaced with defaults', async () => {
    const s = createStorage(dir)
    await fs.writeFile(s.file, JSON.stringify({ ...sample(), version: 2 }), 'utf8')
    expect(await s.load()).toEqual(defaultStore())
    expect(await exists(path.join(dir, 'history.corrupt.json'))).toBe(true)
  })

  it('migrate fills missing opaque player with null', () => {
    const { player: _p, ...rest } = sample()
    expect(migrate(rest).player).toBeNull()
  })
})

describe('game cap', () => {
  it('keeps the newest MAX_GAMES games on save', async () => {
    const s = createStorage(dir)
    const games = Array.from({ length: MAX_GAMES + 5 }, (_, i) => game(i))
    await s.save({ ...sample(), games })
    const loaded = await s.load()
    expect(loaded.games).toHaveLength(MAX_GAMES)
    expect(loaded.games[0]?.id).toBe('g5')
    expect(loaded.games[MAX_GAMES - 1]?.id).toBe(`g${MAX_GAMES + 4}`)
  })

  it('caps games already on disk when loading', async () => {
    const s = createStorage(dir)
    const games = Array.from({ length: MAX_GAMES + 1 }, (_, i) => game(i))
    await fs.writeFile(s.file, JSON.stringify({ ...sample(), games }), 'utf8')
    expect((await s.load()).games).toHaveLength(MAX_GAMES)
  })
})

describe('concurrency', () => {
  it('serialises overlapping saves so the last one wins intact', async () => {
    const s = createStorage(dir)
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => s.save({ ...sample(), muted: i % 2 === 0 })),
    )
    await s.drain()
    expect(typeof (await s.load()).muted).toBe('boolean')
    expect(await exists(s.file + '.tmp')).toBe(false)
  })
})
