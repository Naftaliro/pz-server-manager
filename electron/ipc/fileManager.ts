import { ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

function getServerDataPath(dataPath: string): string {
  // Expand %USERPROFILE% and other env vars on Windows
  return dataPath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`)
}

function getServerDir(dataPath: string): string {
  return join(getServerDataPath(dataPath), 'Server')
}

export function setupFileHandlers() {
  // Read .ini file
  ipcMain.handle('config:readIni', async (_event, serverName: string, dataPath: string) => {
    try {
      const serverDir = getServerDir(dataPath)
      const iniPath = join(serverDir, `${serverName}.ini`)

      if (!existsSync(iniPath)) {
        return { success: true, settings: {}, exists: false }
      }

      const content = readFileSync(iniPath, 'utf-8')
      const settings = parseIni(content)
      return { success: true, settings, exists: true }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Write .ini file — preserves comments and existing lines; only updates changed keys
  ipcMain.handle('config:writeIni', async (_event, serverName: string, dataPath: string, settings: Record<string, unknown>) => {
    try {
      const serverDir = getServerDir(dataPath)
      if (!existsSync(serverDir)) {
        mkdirSync(serverDir, { recursive: true })
      }

      const iniPath = join(serverDir, `${serverName}.ini`)
      const existingContent = existsSync(iniPath) ? readFileSync(iniPath, 'utf-8') : ''
      const content = mergeIni(existingContent, settings)
      writeFileSync(iniPath, content, 'utf-8')
      return { success: true }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Read SandboxVars.lua
  ipcMain.handle('config:readSandbox', async (_event, serverName: string, dataPath: string) => {
    try {
      const serverDir = getServerDir(dataPath)
      const luaPath = join(serverDir, `${serverName}_SandboxVars.lua`)

      if (!existsSync(luaPath)) {
        return { success: true, settings: {}, exists: false }
      }

      const content = readFileSync(luaPath, 'utf-8')
      const settings = parseSandboxLua(content)
      return { success: true, settings, exists: true }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Write SandboxVars.lua — preserves comments and existing lines; only updates changed keys
  ipcMain.handle('config:writeSandbox', async (_event, serverName: string, dataPath: string, settings: Record<string, unknown>) => {
    try {
      const serverDir = getServerDir(dataPath)
      if (!existsSync(serverDir)) {
        mkdirSync(serverDir, { recursive: true })
      }

      const luaPath = join(serverDir, `${serverName}_SandboxVars.lua`)
      const existingContent = existsSync(luaPath) ? readFileSync(luaPath, 'utf-8') : ''
      const content = mergeSandboxLua(existingContent, settings)
      writeFileSync(luaPath, content, 'utf-8')
      return { success: true }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })
}

// ── INI helpers ───────────────────────────────────────────────────────────────

function parseIni(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.substring(0, eqIdx).trim()
    const value = trimmed.substring(eqIdx + 1).trim()
    if (value.toLowerCase() === 'true') result[key] = true
    else if (value.toLowerCase() === 'false') result[key] = false
    else if (!isNaN(Number(value)) && value !== '') result[key] = Number(value)
    else result[key] = value
  }
  return result
}

/**
 * Merge new settings into an existing INI file string.
 * - Lines that already exist are updated in-place (preserving their position)
 * - Comment lines (#, ;) and blank lines are kept as-is
 * - Keys in `settings` that don't exist in the file yet are appended at the end
 */
function mergeIni(existing: string, settings: Record<string, unknown>): string {
  const written = new Set<string>()
  const lines = existing ? existing.split('\n') : []
  const result: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Keep blank lines and comments unchanged
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      result.push(line)
      continue
    }
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) {
      result.push(line)
      continue
    }
    const key = trimmed.substring(0, eqIdx).trim()
    if (key in settings) {
      const val = settings[key]
      if (val !== null && val !== undefined) {
        result.push(`${key}=${val}`)
        written.add(key)
      }
    } else {
      result.push(line)
    }
  }

  // Append any new keys that weren't in the original file
  const newKeys = Object.keys(settings).filter(k => !written.has(k))
  if (newKeys.length > 0) {
    if (result.length > 0 && result[result.length - 1] !== '') result.push('')
    for (const key of newKeys) {
      const val = settings[key]
      if (val !== null && val !== undefined) {
        result.push(`${key}=${val}`)
      }
    }
  }

  return result.join('\n') + (result.length > 0 ? '\n' : '')
}

// ── SandboxVars.lua helpers ───────────────────────────────────────────────────

function parseSandboxLua(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const mainMatch = content.match(/SandboxVars\s*=\s*\{([\s\S]*)\}/)
  if (!mainMatch) return result
  parseluaTable(mainMatch[1], result)
  return result
}

function parseluaTable(body: string, result: Record<string, unknown>) {
  const lines = body.split('\n')
  let inZombieConfig = false
  const zombieConfig: Record<string, unknown> = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('--')) continue

    if (trimmed.includes('ZombieConfig') && trimmed.includes('{')) {
      inZombieConfig = true
      continue
    }

    if (inZombieConfig) {
      if (trimmed === '}' || trimmed === '},') {
        inZombieConfig = false
        result['ZombieConfig'] = zombieConfig
        continue
      }
      const match = trimmed.match(/^(\w+)\s*=\s*(.+?)(?:\s*--.*)?[,]?$/)
      if (match) zombieConfig[match[1]] = parseluaValue(match[2].trim())
      continue
    }

    const match = trimmed.match(/^(\w+)\s*=\s*(.+?)(?:\s*--.*)?[,]?$/)
    if (match) result[match[1]] = parseluaValue(match[2].trim())
  }
}

function parseluaValue(val: string): unknown {
  const v = val.replace(/,$/, '').trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (!isNaN(Number(v))) return Number(v)
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1)
  return v
}

function luaVal(value: unknown): string {
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}

/**
 * Merge new settings into an existing SandboxVars.lua string.
 * - Existing key=value lines inside SandboxVars{} are updated in-place
 * - Comment lines (--) and blank lines are kept as-is
 * - New top-level keys are appended before the closing }
 * - ZombieConfig sub-table keys are merged the same way
 * - If the file doesn't exist yet, generates a clean file from scratch
 */
function mergeSandboxLua(existing: string, settings: Record<string, unknown>): string {
  // If no existing file, generate from scratch
  if (!existing.trim()) {
    return serializeSandboxLua(settings)
  }

  const zombieSettings = settings['ZombieConfig'] as Record<string, unknown> | undefined
  const topSettings = { ...settings }
  delete topSettings['ZombieConfig']

  const writtenTop = new Set<string>()
  const writtenZombie = new Set<string>()

  const lines = existing.split('\n')
  const result: string[] = []
  let inZombieConfig = false
  let zombieBlockEnd = -1 // index of the closing } of ZombieConfig

  // First pass: update existing keys in-place
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Detect ZombieConfig block start
    if (!inZombieConfig && /ZombieConfig\s*=\s*\{/.test(trimmed)) {
      inZombieConfig = true
      result.push(line)
      continue
    }

    if (inZombieConfig) {
      // Detect end of ZombieConfig block
      if (trimmed === '},' || trimmed === '}') {
        // Append any new ZombieConfig keys before closing brace
        if (zombieSettings) {
          const newZombieKeys = Object.keys(zombieSettings).filter(k => !writtenZombie.has(k))
          for (const key of newZombieKeys) {
            const val = zombieSettings[key]
            if (val !== null && val !== undefined) {
              result.push(`        ${key} = ${luaVal(val)},`)
            }
          }
        }
        inZombieConfig = false
        zombieBlockEnd = result.length
        result.push(line)
        continue
      }

      // Try to update ZombieConfig key in-place
      const match = trimmed.match(/^(\w+)\s*=\s*(.+?)(?:\s*--.*)?[,]?$/)
      if (match && zombieSettings && match[1] in zombieSettings) {
        const key = match[1]
        const val = zombieSettings[key]
        if (val !== null && val !== undefined) {
          result.push(`        ${key} = ${luaVal(val)},`)
          writtenZombie.add(key)
        } else {
          result.push(line)
        }
      } else {
        result.push(line)
      }
      continue
    }

    // Top-level key inside SandboxVars = { ... }
    const match = trimmed.match(/^(\w+)\s*=\s*(.+?)(?:\s*--.*)?[,]?$/)
    if (match && match[1] in topSettings) {
      const key = match[1]
      const val = topSettings[key]
      if (val !== null && val !== undefined) {
        result.push(`    ${key} = ${luaVal(val)},`)
        writtenTop.add(key)
      } else {
        result.push(line)
      }
    } else if (trimmed === '}' && !inZombieConfig) {
      // This is the closing brace of SandboxVars — append new top-level keys first
      const newTopKeys = Object.keys(topSettings).filter(k => !writtenTop.has(k))
      for (const key of newTopKeys) {
        const val = topSettings[key]
        if (val !== null && val !== undefined) {
          result.push(`    ${key} = ${luaVal(val)},`)
        }
      }
      result.push(line)
    } else {
      result.push(line)
    }
  }

  void zombieBlockEnd
  return result.join('\n')
}

function serializeSandboxLua(settings: Record<string, unknown>): string {
  const lines: string[] = [
    '-- Project Zomboid Sandbox Configuration',
    '',
    'SandboxVars = {',
  ]

  const zombieConfig = settings['ZombieConfig'] as Record<string, unknown> | undefined

  for (const [key, value] of Object.entries(settings)) {
    if (key === 'ZombieConfig') continue
    if (value === null || value === undefined) continue
    lines.push(`    ${key} = ${luaVal(value)},`)
  }

  if (zombieConfig) {
    lines.push('    ZombieConfig = {')
    for (const [key, value] of Object.entries(zombieConfig)) {
      if (value === null || value === undefined) continue
      lines.push(`        ${key} = ${luaVal(value)},`)
    }
    lines.push('    },')
  }

  lines.push('}')
  return lines.join('\n') + '\n'
}
