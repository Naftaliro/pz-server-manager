// SteamCMD's progress lines: " Update state (0x61) downloading, progress: 42.17 (3003121664 / 7124223981)".
// It goes through several stages that each count 0-100 (preallocating, downloading,
// verifying, committing), so the stage comes along with the numbers
export interface SteamProgress {
  stage: string
  pct: number
  done?: number
  total?: number
}

export function parseSteamProgress(line: string): SteamProgress | null {
  const m = line.match(/Update state \(0x[0-9a-f]+\)\s*([a-z ]+?),\s*progress:\s*([\d.]+)(?:\s*\((\d+)\s*\/\s*(\d+)\))?/i)
  if (!m) return null
  const total = m[4] ? Number(m[4]) : undefined
  return {
    stage: m[1].trim(),
    pct: Math.min(100, parseFloat(m[2])),
    done: m[3] ? Number(m[3]) : undefined,
    total: total || undefined,
  }
}

// "3.2 of 6.6 GB"
export function gbDone(done: number, total: number): string {
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1)
  return `${gb(done)} of ${gb(total)} GB`
}
