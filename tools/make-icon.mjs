// Renders build/icon.svg to a 256px PNG with Electron and wraps it in build/icon.ico.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
const pawn = fs.readFileSync('assets/pieces.svg', 'utf8').match(/<symbol id="bp"[\s\S]*?<\/symbol>/)[0]
const inner = pawn.replace(/<symbol[^>]*>|<\/symbol>/g, '')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><circle cx="128" cy="128" r="124" fill="#cdebc3"/><circle cx="128" cy="128" r="124" fill="none" stroke="#5e9e6b" stroke-width="8"/><g transform="translate(40 36) scale(7.2)" style="--black-fill:#2c5c3f;--black-stroke:#10241a">${inner}</g></svg>`
fs.writeFileSync('build/icon.svg', svg)
const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
const win = await app.firstWindow()
const b64 = await win.evaluate(async (s) => {
  const img = new Image()
  img.src = 'data:image/svg+xml;base64,' + btoa(s)
  await img.decode()
  const c = document.createElement('canvas'); c.width = c.height = 256
  c.getContext('2d').drawImage(img, 0, 0, 256, 256)
  return c.toDataURL('image/png').split(',')[1]
}, svg)
await app.close()
const png = Buffer.from(b64, 'base64')
fs.writeFileSync('build/icon.png', png)
const h = Buffer.alloc(22)
h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4)
h[6] = 0; h[7] = 0; h[8] = 0; h[9] = 0
h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12)
h.writeUInt32LE(png.length, 14); h.writeUInt32LE(22, 18)
fs.writeFileSync('build/icon.ico', Buffer.concat([h, png]))
console.log('icon', png.length)
