// Reading a log file a piece at a time while something else is still writing it. A read
// can end in the middle of a line (or of a multi-byte character), so whatever comes after
// the last newline waits for the next read instead of showing up as half a line.

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
