// Synthesized sounds (WebAudio). No audio files, so nothing to license.
export type Cue = 'move' | 'capture' | 'check' | 'castle' | 'end' | 'win' | 'lose'

let ctx: AudioContext | null = null
let muted = false
let hidden = false

export function setMuted(m: boolean): void {
  muted = m
}
/** True while the window is minimised: no sound. */
export function setHidden(h: boolean): void {
  hidden = h
}
export function isMuted(): boolean {
  return muted
}

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(c: AudioContext, t0: number, freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(c.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

export function play(cue: Cue): void {
  if (muted || hidden) return
  const c = ac()
  if (!c) return
  const t = c.currentTime + 0.005
  switch (cue) {
    case 'move':
      tone(c, t, 220, 0.09, 'triangle', 0.22, 150)
      break
    case 'capture':
      tone(c, t, 180, 0.12, 'triangle', 0.3, 90)
      tone(c, t, 520, 0.05, 'square', 0.05, 260)
      break
    case 'check':
      tone(c, t, 660, 0.11, 'sine', 0.2)
      tone(c, t + 0.09, 880, 0.14, 'sine', 0.2)
      break
    case 'castle':
      tone(c, t, 210, 0.08, 'triangle', 0.2, 150)
      tone(c, t + 0.1, 250, 0.09, 'triangle', 0.2, 170)
      break
    case 'end':
      tone(c, t, 392, 0.22, 'sine', 0.2)
      tone(c, t + 0.16, 330, 0.3, 'sine', 0.2)
      break
    case 'win':
      ;[523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.1, f, 0.28, 'sine', 0.2))
      break
    case 'lose':
      ;[392, 330, 262].forEach((f, i) => tone(c, t + i * 0.16, f, 0.34, 'sine', 0.18))
      break
  }
}
