import { describe, it, expect } from 'vitest'
import { formatEta, formatSingle } from './eta-format'

describe('formatEta', () => {
  it('30 sec → <1 min', () => {
    expect(formatEta(30, 30)).toBe('<1 min')
  })

  it('10 min → 10 min', () => {
    expect(formatEta(600, 600)).toBe('10 min')
  })

  it('59 min → 1 h', () => {
    // 59 rounds to 60 → 1 h
    expect(formatEta(3540, 3540)).toBe('1 h')
  })

  it('60 min → 1 h', () => {
    expect(formatEta(3600, 3600)).toBe('1 h')
  })

  it('75 min → 1 h 15 min', () => {
    expect(formatEta(4500, 4500)).toBe('1 h 15 min')
  })

  it('90 min → 1 h 30 min', () => {
    expect(formatEta(5400, 5400)).toBe('1 h 30 min')
  })

  it('120 min → 2 h', () => {
    expect(formatEta(7200, 7200)).toBe('2 h')
  })

  it('range 45–75 min → 45 min–1 h 15 min', () => {
    // 45 min = 2700s, 75 min = 4500s
    expect(formatEta(2700, 4500)).toBe('45 min–1 h 15 min')
  })

  it('range 60–120 min → 1–2 h', () => {
    expect(formatEta(3600, 7200)).toBe('1–2 h')
  })

  it('range 75–130 min → 1 h 15 min–2 h 10 min', () => {
    // 75 → 75, 130 → 130
    expect(formatEta(4500, 7800)).toBe('1 h 15 min–2 h 10 min')
  })

  it('range 65–80 min → 1 h 5–20 min', () => {
    expect(formatEta(3900, 4800)).toBe('1 h 5–20 min')
  })

  it('range 90–150 min → 1 h 30 min–2 h 30 min', () => {
    expect(formatEta(5400, 9000)).toBe('1 h 30 min–2 h 30 min')
  })

  it('range 10–15 min → 10–15 min', () => {
    expect(formatEta(600, 900)).toBe('10–15 min')
  })

  it('very short → ~X sec', () => {
    expect(formatEta(5, 10)).toBe('~10 sec')
  })

  it('under 1 min → <1 min', () => {
    expect(formatEta(20, 45)).toBe('<1 min')
  })

  it('119 min rounds to 2 h', () => {
    expect(formatEta(7140, 7140)).toBe('2 h')
  })

  it('121 min rounds to 2 h', () => {
    expect(formatEta(7260, 7260)).toBe('2 h')
  })

  it('76 min → 1 h 15 min', () => {
    expect(formatEta(4560, 4560)).toBe('1 h 15 min')
  })

  it('78 min → 1 h 20 min', () => {
    expect(formatEta(4680, 4680)).toBe('1 h 20 min')
  })

  it('123 min → 2 h 5 min', () => {
    expect(formatEta(7380, 7380)).toBe('2 h 5 min')
  })

  it('range 2700–4500s → 45 min–1 h 15 min', () => {
    expect(formatEta(2700, 4500)).toBe('45 min–1 h 15 min')
  })

  it('range 3600–7200s → 1–2 h', () => {
    expect(formatEta(3600, 7200)).toBe('1–2 h')
  })

  it('range 4500–7800s → 1 h 15 min–2 h 10 min', () => {
    expect(formatEta(4500, 7800)).toBe('1 h 15 min–2 h 10 min')
  })
})

describe('formatSingle', () => {
  it('1 → 1 min', () => {
    expect(formatSingle(1)).toBe('1 min')
  })

  it('10 → 10 min', () => {
    expect(formatSingle(10)).toBe('10 min')
  })

  it('59 → 1 h', () => {
    expect(formatSingle(59)).toBe('1 h')
  })

  it('60 → 1 h', () => {
    expect(formatSingle(60)).toBe('1 h')
  })

  it('75 → 1 h 15 min', () => {
    expect(formatSingle(75)).toBe('1 h 15 min')
  })

  it('120 → 2 h', () => {
    expect(formatSingle(120)).toBe('2 h')
  })

  it('0.5 → 1 min (min 1)', () => {
    expect(formatSingle(0.5)).toBe('1 min')
  })
})
