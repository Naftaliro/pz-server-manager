import { describe, it, expect } from 'vitest'
import { parseSteamProgress, gbDone } from './steamProgress'

describe('parseSteamProgress', () => {
  it('reads the stage, percent and bytes from a console_log line', () => {
    expect(parseSteamProgress('Update state (0x61) downloading, progress: 83.97 (5982438426 / 7124223981)')).toEqual({
      stage: 'downloading', pct: 83.97, done: 5982438426, total: 7124223981,
    })
  })
  it('works without the byte counts', () => {
    expect(parseSteamProgress(' Update state (0x5) verifying install, progress: 12.50')).toEqual({ stage: 'verifying install', pct: 12.5, done: undefined, total: undefined })
  })
  it('ignores other lines', () => {
    expect(parseSteamProgress('Success! App \'380870\' fully installed.')).toBeNull()
  })
})

describe('gbDone', () => {
  it('shows GB done of the total', () => {
    expect(gbDone(5982438426, 7124223981)).toBe('5.6 of 6.6 GB')
  })
})
