// Real skill-100 bot (levels timeMs cap) vs a fixed depth-2 engine. Usage: npx tsx tools/skill100.ts [games=20]
import { botMover, fixedDepthMover, playGame, rngFrom } from '../src/engine/match'

const n = Number(process.argv[2] ?? 20)
const rnd = rngFrom(4242)
const strong = botMover(100, rnd, 2300)
const weak = fixedDepthMover(2)
let wins = 0
for (let g = 0; g < n; g++) {
  const w = g % 2 === 0
  const o = playGame(w ? strong : weak, w ? weak : strong, { openingPlies: 4, rng: rnd, maxPlies: 400 })
  if (o.result === (w ? 1 : -1)) wins++
  console.log(g, w ? "strong=W" : "strong=B", o.result, o.termination, o.plies)
}
console.log(`skill 100 wins ${wins}/${n}`)
