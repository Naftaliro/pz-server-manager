// Reading a log file a piece at a time while something else is still writing it. A read
// can end in the middle of a line (or of a multi-byte character), so whatever comes after
// the last newline waits for the next read instead of showing up as half a line.

import { existsSync, statSync, openSync, readSync, closeSync } from 'fs'

export interface LineChunk {
  lines: string[]
  // bytes after the last newline, put in front of the next read
  rest: Buffer
}

export function takeLines(pending: Buffer, chunk: Buffer): LineChunk {
  const all = pending.length ? Buffer.concat([pending, chunk]) : chunk
  const end = all.lastIndexOf(0x0a)
  if (end === -1) return { lines: [], rest: all }
  return {
    lines: all.subarray(0, end).toString('utf-8').split(/\r?\n/).map(l => l.replace(/\r$/, '')),
    rest: Buffer.from(all.subarray(end + 1)),
  }
}

// Every new line another program adds to a file from now on (what's already there is
// skipped), until stop(). A file that gets smaller was started over, so it's read from the top
export function followFile(path: string, onLine: (line: string) => void, everyMs = 1000): { stop: () => void } {
  let offset = existsSync(path) ? statSync(path).size : 0
  let rest: Buffer = Buffer.alloc(0)
  const read = () => {
    let size: number
    try { size = statSync(path).size } catch { return }
    if (size < offset) { offset = 0; rest = Buffer.alloc(0) }
    if (size === offset) return
    const length = Math.min(size - offset, 1024 * 1024)
    const buf = Buffer.alloc(length)
    let fd: number | null = null
    try {
      fd = openSync(path, 'r')
      readSync(fd, buf, 0, length, offset)
    } catch { return } finally { if (fd !== null) closeSync(fd) }
    offset += length
    const chunk = takeLines(rest, buf)
    rest = chunk.rest
    chunk.lines.forEach(l => { if (l.trim()) onLine(l) })
  }
  const timer = setInterval(read, everyMs)
  return { stop: () => { clearInterval(timer); read() } }
}
