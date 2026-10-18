// WCAG contrast check for text, piece and focus colours against the square and panel colours.
import { readFileSync } from 'node:fs'
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
const tok = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]))
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const pairs = [
  ['text on bg', 'text', 'bg', 4.5],
  ['muted on bg', 'muted', 'bg', 4.5],
  ['muted on panel', 'muted', 'panel', 4.5],
  ['win on panel', 'win', 'panel', 4.5],
  ['loss on panel', 'loss', 'panel', 4.5],
  ['draw on panel', 'draw', 'panel', 4.5],
  ['coord (light sq)', '#2f6b43', 'sq-light', 4.5],
  ['coord (dark sq)', '#0f2a1a', 'sq-dark', 4.5],
  ['ivory piece on light sq', 'white-fill', 'sq-light', 3],
  ['ivory piece on dark sq', 'white-fill', 'sq-dark', 3],
  ['ivory piece outline on light sq', 'white-stroke', 'sq-light', 3],
  ['ivory piece outline on dark sq', 'white-stroke', 'sq-dark', 3],
  ['forest piece on light sq', 'black-fill', 'sq-light', 3],
  ['forest piece on dark sq', 'black-fill', 'sq-dark', 3],
  ['forest piece outline on light sq', 'black-stroke', 'sq-light', 3],
  ['forest piece outline on dark sq', 'black-stroke', 'sq-dark', 3],
  ['focus ring outer edge on light sq', 'black-stroke', 'sq-light', 3],
  ['focus ring outer edge on dark sq', 'black-stroke', 'sq-dark', 3],
  ['focus ring yellow vs its dark edge', 'focus', 'black-stroke', 3],
]
let fail = 0
for (const [name, a, b, min] of pairs) {
  const fa = a.startsWith('#') ? a : tok[a]
  const fb = b.startsWith('#') ? b : tok[b]
  const r = ratio(fa, fb)
  const ok = r >= min
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.toFixed(2)}:1 (min ${min}) ${name}`)
}
console.log(fail ? `${fail} below minimum` : 'all pass')
process.exitCode = fail ? 1 : 0
