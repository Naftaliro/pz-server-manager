import { describe, it, expect } from 'vitest'
import { takeLines } from './logTail'

const feed = (chunks: Array<string | Buffer>) => {
  let rest = Buffer.alloc(0)
  const out: string[] = []
  for (const c of chunks) {
    const r = takeLines(rest, Buffer.isBuffer(c) ? c : Buffer.from(c))
    out.push(...r.lines)
    rest = r.rest
  }
  return { out, rest: rest.toString('utf-8') }
}

describe('takeLines', () => {
  it('keeps a line cut in two by a read until the rest of it arrives', () => {
    const { out, rest } = feed(['LOG  : General      f:0> one\r\nLOG  : Gen', 'eral      f:0> two\r\n'])
    expect(out).toEqual(['LOG  : General      f:0> one', 'LOG  : General      f:0> two'])
    expect(rest).toBe('')
  })

  it('holds back a last line without a newline', () => {
    const { out, rest } = feed(['a\nb\nSERVER STAR'])
    expect(out).toEqual(['a', 'b'])
    expect(rest).toBe('SERVER STAR')
    expect(feed(['a\nb\nSERVER STAR', 'TED ***\n']).out).toContain('SERVER STARTED ***')
  })

  it("doesn't break a multi-byte character split between two reads", () => {
    const bytes = Buffer.from('C:\\Users\\José\\Zomboid\n')
    const cut = bytes.indexOf(0xa9) // second byte of é
    const { out } = feed([bytes.subarray(0, cut), bytes.subarray(cut)])
    expect(out).toEqual(['C:\\Users\\José\\Zomboid'])
  })

  it('handles a read with no newline at all', () => {
    expect(feed(['abc', 'def']).out).toEqual([])
    expect(feed(['abc', 'def', '\n']).out).toEqual(['abcdef'])
  })
})
