import { describe, expect, it } from 'vitest'
import { Position } from '../src/engine/board'
import { toSan } from '../src/ui/san'

function play(fen: string | undefined, ucis: string[]): string[] {
  const pos = fen ? new Position(fen) : new Position()
  return ucis.map((u) => {
    const m = pos.parseUci(u)
    if (m < 0) throw new Error('illegal ' + u)
    const s = toSan(pos, m)
    pos.makeMove(m)
    return s
  })
}

describe('san', () => {
  it('plays a short game with castling, capture, check, mate', () => {
    const out = play(undefined, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1', 'f6e4', 'd2d4', 'e5d4', 'f1e1', 'd7d5', 'c4d5', 'd8d5'])
    expect(out).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O', 'Nxe4', 'd4', 'exd4', 'Re1', 'd5', 'Bxd5', 'Qxd5'])
  })
  it('fool\'s mate gives #', () => {
    expect(play(undefined, ['f2f3', 'e7e5', 'g2g4', 'd8h4']).pop()).toBe('Qh4#')
  })
  it('disambiguates by file and rank', () => {
    expect(play('4k3/8/8/8/8/8/4K3/R6R w - - 0 1', ['a1d1'])[0]).toBe('Rad1')
    expect(play('4k3/R7/8/8/8/8/R7/4K3 w - - 0 1', ['a2a4'])[0]).toBe('R2a4')
  })
  it('promotion and en passant', () => {
    expect(play('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', ['a7a8q'])[0]).toBe('a8=Q+')
    expect(play('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', ['e5d6'])[0]).toBe('exd6')
  })
  it('queenside castle', () => {
    expect(play('r3k3/8/8/8/8/8/8/R3K3 b q - 0 1', ['e8c8'])[0]).toBe('O-O-O')
  })
})
