// Small hand-written opening book: sound lines of up to six plies, written as UCI moves.
// The bot picks any line that continues the game so far, uniformly at random.
const TEXT = `
e2e4 e7e5 g1f3 b8c6 f1b5 a7a6
e2e4 e7e5 g1f3 b8c6 f1b5 g8f6
e2e4 e7e5 g1f3 b8c6 f1c4 g8f6
e2e4 e7e5 g1f3 b8c6 f1c4 f8c5
e2e4 e7e5 g1f3 b8c6 d2d4 e5d4
e2e4 e7e5 g1f3 b8c6 b1c3 g8f6
e2e4 e7e5 g1f3 g8f6 f3e5 d7d6
e2e4 e7e5 g1f3 d7d6 d2d4 e5d4
e2e4 e7e5 f1c4 g8f6 d2d3 c7c6
e2e4 c7c5 g1f3 d7d6 d2d4 c5d4
e2e4 c7c5 g1f3 b8c6 d2d4 c5d4
e2e4 c7c5 g1f3 e7e6 d2d4 c5d4
e2e4 c7c5 b1c3 b8c6 g2g3 g7g6
e2e4 c7c5 c2c3 d7d5 e4d5 d8d5
e2e4 e7e6 d2d4 d7d5 b1c3 g8f6
e2e4 e7e6 d2d4 d7d5 e4e5 c7c5
e2e4 c7c6 d2d4 d7d5 b1c3 d5e4
e2e4 c7c6 d2d4 d7d5 e4e5 c8f5
e2e4 d7d5 e4d5 d8d5 b1c3 d5a5
e2e4 g8f6 e4e5 f6d5 d2d4 d7d6
e2e4 d7d6 d2d4 g8f6 b1c3 g7g6
e2e4 g7g6 d2d4 f8g7 b1c3 d7d6
d2d4 d7d5 c2c4 e7e6 b1c3 g8f6
d2d4 d7d5 c2c4 c7c6 g1f3 g8f6
d2d4 d7d5 c2c4 d5c4 g1f3 g8f6
d2d4 d7d5 g1f3 g8f6 c2c4 e7e6
d2d4 d7d5 g1f3 g8f6 e2e3 e7e6
d2d4 d7d5 c1f4 g8f6 e2e3 e7e6
d2d4 g8f6 c2c4 e7e6 b1c3 f8b4
d2d4 g8f6 c2c4 g7g6 b1c3 f8g7
d2d4 g8f6 c2c4 e7e6 g1f3 b7b6
d2d4 g8f6 g1f3 e7e6 c2c4 d7d5
d2d4 g8f6 c1g5 e7e6 e2e3 d7d5
d2d4 f7f5 g2g3 g8f6 f1g2 e7e6
d2d4 e7e6 e2e4 d7d5 b1c3 g8f6
g1f3 d7d5 d2d4 g8f6 c2c4 e7e6
g1f3 g8f6 c2c4 g7g6 b1c3 f8g7
g1f3 g8f6 g2g3 g7g6 f1g2 f8g7
g1f3 d7d5 g2g3 g8f6 f1g2 e7e6
g1f3 c7c5 c2c4 g8f6 b1c3 b8c6
c2c4 e7e5 b1c3 g8f6 g1f3 b8c6
c2c4 g8f6 b1c3 e7e5 g1f3 b8c6
c2c4 c7c5 g1f3 g8f6 b1c3 b8c6
c2c4 e7e6 g1f3 d7d5 g2g3 g8f6
b2b3 e7e5 c1b2 b8c6 e2e3 d7d5
`

export const BOOK_LINES: readonly string[][] = TEXT.trim()
  .split('\n')
  .map((l) => l.trim().split(' '))

/** Returns a book reply (UCI) for the game so far, or null. */
export function bookMove(history: string[], rnd: () => number): string | null {
  if (history.length >= 6) return null
  const options: string[] = []
  for (const line of BOOK_LINES) {
    let ok = true
    for (let i = 0; i < history.length; i++) if (line[i] !== history[i]) ok = false
    const next = line[history.length]
    if (ok && next) options.push(next)
  }
  if (!options.length) return null
  return options[Math.floor(rnd() * options.length)]!
}
