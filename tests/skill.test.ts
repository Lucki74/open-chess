import { describe, expect, test } from 'vitest'
import { eloForSkill, skillForElo } from '../src/engine/levels'
import { rngFrom } from '../src/engine/match'
import { MATE } from '../src/engine/search'
import { moveQuality, summarize } from '../src/skill/analysis'
import { chooseBotSkill, EasingTracker } from '../src/skill/adapt'
import {
  ACPL_ELO_CURVE,
  BLEND_ACPL,
  BLEND_RESULT,
  BOT_OFFSET,
  CP_LOSS_CAP,
  K_END,
  K_START,
  LOSS_STREAK_2_ADJ,
  LOSS_STREAK_3_ADJ,
  MAX_RATING_STEP,
  RATING_MAX,
  RATING_MIN,
  RD_IDLE_GROWTH,
  RD_MAX,
  START_RATING,
  WIN_STREAK_3_ADJ,
} from '../src/skill/constants'
import { acplToElo, cpLoss, expectedScore, initialPlayerState, kFactor, updateAfterGame } from '../src/skill/rating'
import type { GameSummary, PlayerState, RecentGame } from '../src/skill/types'

const DAY = 86_400_000

function stateWith(over: Partial<PlayerState>): PlayerState {
  return { ...initialPlayerState(), games: 20, lastGameAt: 0, ...over }
}

function summary(over: Partial<GameSummary>): GameSummary {
  return { result: 0.5, acpl: null, blunders: 0, plies: 60, hintsUsed: 0, botElo: 1000, endedAt: 0, ...over }
}

function recentOf(results: (0 | 1 | 0.5)[], botElo: number[]): RecentGame[] {
  return results.map((result, i) => ({ result, botElo: botElo[i] ?? botElo[botElo.length - 1]! }))
}

describe('rating formula', () => {
  test('initial state starts at 800 with high rd', () => {
    const s = initialPlayerState()
    expect(s.rating).toBe(START_RATING)
    expect(s.rd).toBeGreaterThanOrEqual(RD_MAX)
    expect(s.games).toBe(0)
    expect(s.lastGameAt).toBeNull()
  })

  test('expected score is 0.5 at equal ratings and symmetric', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 10)
    expect(expectedScore(1600, 1500) + expectedScore(1500, 1600)).toBeCloseTo(1, 10)
  })

  test('K starts at 64, decays to 24 after 15 games and stays there', () => {
    expect(kFactor(0)).toBe(K_START)
    expect(kFactor(15)).toBe(K_END)
    expect(kFactor(100)).toBe(K_END)
    expect(kFactor(7.5)).toBeCloseTo((K_START + K_END) / 2, 10)
  })

  test('result-only update follows K * (S - E) once placement is over', () => {
    const s = stateWith({ rating: 1000, games: 15, lastGameAt: null })
    const win = updateAfterGame(s, summary({ result: 1, botElo: 1000, plies: 60, endedAt: 0 }))
    expect(win.delta).toBeCloseTo(K_END * 0.5, 6)
    expect(win.state.rating).toBeCloseTo(1000 + K_END * 0.5, 6)
    expect(win.state.games).toBe(16)
  })

  test('placement games use a larger step', () => {
    const fresh = initialPlayerState()
    const win = updateAfterGame(fresh, summary({ result: 1, botElo: START_RATING, plies: 60 }))
    expect(win.delta).toBeCloseTo(K_START * 1.5 * 0.5, 6)
  })

  test('ACPL blends in with the BLEND_RESULT and BLEND_ACPL weights', () => {
    const s = stateWith({ rating: 1000, games: 15 })
    const r = updateAfterGame(s, summary({ result: 0.5, acpl: 40, botElo: 1000, plies: 60 }))
    const expectedCandidate = BLEND_RESULT * 1000 + BLEND_ACPL * acplToElo(40)
    expect(r.state.rating).toBeCloseTo(expectedCandidate, 6)
  })

  test('a single game never moves the rating more than MAX_RATING_STEP', () => {
    const rnd = rngFrom(99)
    for (let i = 0; i < 2000; i++) {
      const rating = 200 + Math.floor(rnd() * 2400)
      const s = stateWith({ rating, games: Math.floor(rnd() * 40), lastGameAt: 0 })
      const result = ([0, 0.5, 1] as const)[Math.floor(rnd() * 3)]!
      const r = updateAfterGame(s, summary({ result, acpl: rnd() < 0.5 ? null : rnd() * 600, blunders: Math.floor(rnd() * 10), plies: 2 + Math.floor(rnd() * 200), botElo: rnd() * 3000, endedAt: 0 }))
      expect(Math.abs(r.delta)).toBeLessThanOrEqual(MAX_RATING_STEP + 1e-9)
      expect(r.state.rating).toBeGreaterThanOrEqual(RATING_MIN)
      expect(r.state.rating).toBeLessThanOrEqual(RATING_MAX)
    }
  })

  test('short losses weigh more than long losses', () => {
    const s = stateWith({ rating: 1200, games: 15 })
    const quick = updateAfterGame(s, summary({ result: 0, plies: 20, botElo: 1200 })).delta
    const long = updateAfterGame(s, summary({ result: 0, plies: 80, botElo: 1200 })).delta
    expect(quick).toBeLessThan(long)
    expect(quick).toBeCloseTo(long * 1.5, 6)
  })

  test('hints reduce gain from wins but not losses', () => {
    const s = stateWith({ rating: 1200, games: 15 })
    const none = updateAfterGame(s, summary({ result: 1, botElo: 1200 })).delta
    const three = updateAfterGame(s, summary({ result: 1, botElo: 1200, hintsUsed: 3 })).delta
    expect(three).toBeGreaterThan(0)
    expect(three).toBeLessThan(none)
    const lossNone = updateAfterGame(s, summary({ result: 0, botElo: 1200, plies: 60 })).delta
    const lossHints = updateAfterGame(s, summary({ result: 0, botElo: 1200, plies: 60, hintsUsed: 3 })).delta
    expect(lossHints).toBeCloseTo(lossNone, 9)
  })

  test('rd grows after 30 idle days and is never above RD_MAX', () => {
    const s = stateWith({ rd: 80, lastGameAt: 0 })
    const soon = updateAfterGame(s, summary({ endedAt: 2 * DAY }))
    const idle = updateAfterGame(s, summary({ endedAt: 65 * DAY }))
    expect(idle.state.rd).toBeGreaterThan(soon.state.rd)
    expect(idle.state.rd).toBeLessThanOrEqual(RD_MAX)
    const huge = updateAfterGame(stateWith({ rd: RD_MAX, lastGameAt: 0 }), summary({ endedAt: 3000 * DAY }))
    expect(huge.state.rd).toBeLessThanOrEqual(RD_MAX)
    expect(RD_IDLE_GROWTH).toBeGreaterThan(0)
  })

  test('rating clamps to the allowed range', () => {
    const top = stateWith({ rating: RATING_MAX, games: 40 })
    expect(updateAfterGame(top, summary({ result: 1, acpl: 0, botElo: 100, plies: 200 })).state.rating).toBeLessThanOrEqual(RATING_MAX)
    const bottom = stateWith({ rating: RATING_MIN, games: 40 })
    expect(updateAfterGame(bottom, summary({ result: 0, acpl: 900, botElo: 3000, plies: 10 })).state.rating).toBeGreaterThanOrEqual(RATING_MIN)
  })

  test('recent list keeps the last 20 games', () => {
    let s = initialPlayerState()
    for (let i = 0; i < 25; i++) s = updateAfterGame(s, summary({ result: 0.5, botElo: 800 + i, endedAt: i * DAY })).state
    expect(s.recent).toHaveLength(20)
    expect(s.recent[0]!.botElo).toBe(805)
  })
})

describe('ACPL and cp loss', () => {
  test('ACPL curve is monotone non-increasing in Elo', () => {
    let prev = Infinity
    for (let acpl = 0; acpl <= 300; acpl += 0.5) {
      const e = acplToElo(acpl)
      expect(e).toBeLessThanOrEqual(prev + 1e-9)
      prev = e
    }
  })

  test('ACPL curve hits its anchor points', () => {
    for (const [a, e] of ACPL_ELO_CURVE) expect(acplToElo(a)).toBeCloseTo(e, 6)
  })

  test('cp loss is non-negative and capped', () => {
    expect(cpLoss(100, 100)).toBe(0)
    expect(cpLoss(0, 300)).toBe(0)
    expect(cpLoss(0, -300)).toBe(300)
    expect(cpLoss(5000, -5000)).toBe(CP_LOSS_CAP)
  })

  test('mate scores are clamped before subtraction', () => {
    // mate for us against a small gain: clamped to 1000, so loss is 900 then capped at 500
    expect(cpLoss(MATE - 5, 100)).toBe(CP_LOSS_CAP)
    // getting mated from a mate-free position is a full cap, not a huge value
    expect(cpLoss(50, -MATE + 5)).toBe(CP_LOSS_CAP)
    // both sides mate: equal clamps, no loss
    expect(cpLoss(MATE - 5, MATE - 9)).toBe(0)
  })

  test('summarize gives ACPL and blunders above 200', () => {
    expect(summarize([])).toEqual({ acpl: null, blunders: 0 })
    const s = summarize([0, 100, 300])
    expect(s.acpl).toBeCloseTo(400 / 3, 6)
    expect(s.blunders).toBe(1)
  })

  test('moveQuality scores a hanging queen and a correct capture', () => {
    const fen = '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1'
    expect(moveQuality(fen, 'd1d5', 3)).toBe(0)
    expect(moveQuality(fen, 'e1f2', 3)).toBe(CP_LOSS_CAP)
  })
})

describe('bot level choice', () => {
  test('first game uses rating minus offset', () => {
    const c = chooseBotSkill(initialPlayerState())
    expect(c.botElo).toBe(START_RATING + BOT_OFFSET)
    expect(c.skill).toBeCloseTo(skillForElo(START_RATING + BOT_OFFSET), 9)
    expect(c.skill).toBeGreaterThanOrEqual(0)
    expect(c.skill).toBeLessThanOrEqual(100)
  })

  test('two losses drop the bot by 80, three by 150', () => {
    const base = 1200
    const two = stateWith({ rating: base, games: 5, botElo: base + BOT_OFFSET, recent: recentOf([1, 0, 0], [1180, 1180, 1180]) })
    expect(chooseBotSkill(two).botElo).toBeCloseTo(base + BOT_OFFSET + LOSS_STREAK_2_ADJ, 6)
    const three = stateWith({ rating: base, games: 5, botElo: base + BOT_OFFSET, recent: recentOf([0, 0, 0], [1180, 1180, 1180]) })
    expect(chooseBotSkill(three).botElo).toBeCloseTo(base + BOT_OFFSET + LOSS_STREAK_3_ADJ, 6)
  })

  test('one loss has no streak nudge', () => {
    const s = stateWith({ rating: 1200, games: 5, botElo: 1180, recent: recentOf([1, 1, 0], [1180, 1180, 1180]) })
    expect(chooseBotSkill(s).botElo).toBeCloseTo(1180, 6)
  })

  test('three wins raise the bot by 100 but rises are capped per game', () => {
    const s = stateWith({ rating: 1200, games: 5, botElo: 1180, recent: recentOf([1, 1, 1], [1100, 1150, 1180]) })
    // base 1180 + 100 would be 1280, capped at previous 1180 + 100 = 1280, so exact
    expect(chooseBotSkill(s).botElo).toBeCloseTo(1280, 6)
    const big = stateWith({ rating: 2000, games: 5, botElo: 1100, recent: recentOf([1, 1, 1], [1100, 1100, 1100]) })
    expect(chooseBotSkill(big).botElo).toBeLessThanOrEqual(1100 + 100 + 1e-9)
  })

  test('rise over any 3 games is capped at 250', () => {
    // three games ago the bot was at 1000; base is far above, so the per-game cap alone would allow more
    const s = stateWith({ rating: 2000, games: 6, botElo: 1200, recent: recentOf([1, 1, 1], [1000, 1100, 1200]) })
    expect(chooseBotSkill(s).botElo).toBeLessThanOrEqual(1000 + 250 + 1e-9)
  })

  test('skill stays inside 0..100 at the extremes', () => {
    const low = chooseBotSkill(stateWith({ rating: 0, games: 40, botElo: 0 }))
    expect(low.skill).toBe(0)
    const high = chooseBotSkill(stateWith({ rating: 5000, games: 40, botElo: 1900 }))
    expect(high.skill).toBeLessThanOrEqual(100)
    expect(high.botElo).toBeLessThanOrEqual(eloForSkill(100) + 1e-9)
  })
})

describe('mid-game easing', () => {
  test('easing latches once when the player is lost early', () => {
    const t = new EasingTracker()
    let st = t.observe(-600, 10)
    expect(st.easing).toBe(false)
    for (let p = 11; p < 20; p++) st = t.observe(-600, p)
    expect(st.easing).toBe(true)
    expect(st.easingApplied).toBe(true)
    // recovery does not switch it off for the rest of the game
    for (let p = 20; p < 60; p++) st = t.observe(0, p)
    expect(st.easing).toBe(true)
  })

  test('no easing after move 20 (ply 40)', () => {
    const t = new EasingTracker()
    let st = t.observe(0, 50)
    for (let p = 50; p < 60; p++) st = t.observe(-900, p)
    expect(st.easing).toBe(false)
    expect(st.easingApplied).toBe(false)
  })

  test('a one-ply eval spike does not trigger easing', () => {
    const t = new EasingTracker()
    t.observe(-900, 5)
    const st = t.observe(0, 6)
    expect(st.easingApplied).toBe(false)
  })

  test('a crushing player turns easing off for good', () => {
    const t = new EasingTracker()
    for (let p = 0; p < 4; p++) t.observe(-700, 5 + p)
    expect(t.easingApplied).toBe(true)
    let st = t.observe(0, 12)
    for (let p = 0; p < 6; p++) st = t.observe(900, 13 + p)
    expect(st.easing).toBe(false)
    for (let p = 0; p < 10; p++) st = t.observe(-900, 20 + p)
    expect(st.easing).toBe(false)
  })
})
