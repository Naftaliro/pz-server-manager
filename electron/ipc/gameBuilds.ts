import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { isBuildId, type BuildFacts } from '../../shared/gameVersion'

// What each server build turned out to be (game version from its log, world version from
// map_t.bin after it saved), learned as servers run. Steam's branch list only has build ids

function file(): string {
  return join(app.getPath('userData'), 'game-builds.json')
}

let cache: Record<string, BuildFacts> | null = null

export function learnedBuilds(): Record<string, BuildFacts> {
  if (cache) return cache
  try { cache = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf-8')) : {} } catch { cache = {} }
  return cache!
}

export function learnBuild(buildId: string | null | undefined, facts: BuildFacts) {
  if (!isBuildId(buildId)) return
  const all = learnedBuilds()
  const was = all[buildId] || {}
  const next = { ...was, ...Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined)) }
  if (JSON.stringify(next) === JSON.stringify(was)) return
  all[buildId] = next
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(file(), JSON.stringify(all, null, 2), 'utf-8')
  } catch { /* only a cache */ }
}
