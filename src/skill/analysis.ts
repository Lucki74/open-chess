import { Position } from '../engine/board'
import { type Limits, Searcher } from '../engine/search'
import { ANALYSIS_DEPTH, BLUNDER_CP } from './constants'
import { cpLoss } from './rating'

export interface MoveSummary {
  acpl: number | null
  blunders: number
}

let shared: Searcher | null = null
function defaultSearcher(): Searcher {
  if (!shared) shared = new Searcher(18)
  return shared
}

function limits(depth: number): Limits {
  return { maxDepth: depth, maxNodes: 1e9, timeMs: 1e9, qDepth: 6, nullMove: false, lmr: false }
}

/**
 * Centipawn loss of `uciPlayed` in `fenBefore`. Best and played are compared at the same total depth:
 * best = search(before, depth); played = -search(after, depth - 1).
 * Requires depth >= 2.
 */
export function moveQuality(
  fenBefore: string,
  uciPlayed: string,
  depth: number = ANALYSIS_DEPTH,
  searcher: Searcher = defaultSearcher(),
): number {
  if (depth < 2) throw new Error('moveQuality needs depth >= 2')
  const pos = new Position(fenBefore)
  const best = searcher.search(pos, limits(depth)).score
  const m = pos.parseUci(uciPlayed)
  if (m < 0) throw new Error(`illegal uci ${uciPlayed} in ${fenBefore}`)
  pos.makeMove(m)
  const played = -searcher.search(pos, limits(depth - 1)).score
  return cpLoss(best, played)
}

/** ACPL (mean cp loss) and blunder count (loss above BLUNDER_CP). acpl is null for no moves. */
export function summarize(losses: number[]): MoveSummary {
  if (!losses.length) return { acpl: null, blunders: 0 }
  let sum = 0
  let blunders = 0
  for (const l of losses) {
    sum += l
    if (l > BLUNDER_CP) blunders++
  }
  return { acpl: sum / losses.length, blunders }
}
