#!/usr/bin/env node
// Ready-made modded servers (src/lib/modPresets.ts): refresh their data, and test-start each
// one on a real dedicated server.
//
//   node scripts/verify-presets.mjs refresh --install <server folder> [--steamcmd <steamcmd.exe>] [--preset <key>]
//     Downloads every preset's Workshop items with SteamCMD (anonymous), reads their mod.info
//     files the way the app does, asks Steam for names, pictures and sizes, sorts the load order
//     with the app's own sort and writes it all to src/lib/presetData.json. Run it after changing
//     a preset's list.
//
//   node scripts/verify-presets.mjs verify --install <server folder> [--steamcmd <steamcmd.exe>]
//       [--preset <key>] [--work <folder>] [--port 16661] [--memory 4096] [--timeout 900]
//       [--no-download] [--no-baseline] [--update] [--out <results.json>]
//     For each preset: a fresh data folder (-cachedir) with the preset's .ini, sandbox and mod
//     list, the mods downloaded, a real server started on the given install on --port (and the
//     two ports after it), then it waits for "*** SERVER STARTED ***" or a failed start, stops the
//     server and groups the log's errors by mod. A vanilla start comes first so errors the game
//     prints without any mods don't count. --update writes the result into the preset's
//     "verified" field. Run it after every game update and before every release, then commit
//     presetData.json.
//
// Needs Node 22, `npm ci`, a dedicated server install (SteamCMD app 380870) and SteamCMD.
// Nothing here goes through a shell: SteamCMD and java get their arguments as separate items.

import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync, statSync, copyFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve, dirname, basename, relative } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_FILE = join(ROOT, 'src', 'lib', 'presetData.json')
const LOCAL_MODS = join(ROOT, 'local-mods')

// ── arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const key = a.slice(2)
    if (key.startsWith('no-')) { out[key.slice(3)] = false; continue }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0] || 'verify'
if (!['refresh', 'verify'].includes(command) || args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('\n').filter(l => l.startsWith('//')).slice(0, 22).map(l => l.slice(3)).join('\n'))
  process.exit(args.help ? 0 : 1)
}
const install = args.install || process.env.PZ_SERVER_DIR
const steamcmd = args.steamcmd || process.env.PZ_STEAMCMD || 'C:\\PZServerManager\\steamcmd\\steamcmd.exe'
if (!install || !existsSync(join(install, 'StartServer64.bat'))) fail(`--install has to be a dedicated server folder (with StartServer64.bat), got ${install}`)
const port = Number(args.port || 16661)
const memoryMb = Number(args.memory || 4096)
const timeoutS = Number(args.timeout || 900)
const work = resolve(args.work || join(os.tmpdir(), 'knox-preset-check'))
const cachePrefix = args['cache-prefix'] || 'knox-check-'

function fail(msg) { console.error(`\n${msg}`); process.exit(1) }
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a)

// ── the app's own code ───────────────────────────────────────────────────────

const { runnerImport } = await import('vite')
async function load(rel) {
  const { module } = await runnerImport(join(ROOT, rel), { configFile: false, root: ROOT, logLevel: 'error' })
  return module
}
const presetsMod = await load('src/lib/modPresets.ts')
const modScan = await load('electron/ipc/modScan.ts')
const modCore = await load('shared/modCore.ts')
const gameConfig = await load('shared/gameConfig.ts')
const logCheck = await load('shared/serverLogCheck.ts')
const appMods = await load('src/lib/mods.ts')
const { steamImageUrl } = await load('shared/workshopItem.ts')

const sources = presetsMod.MODDED_PRESET_SOURCES.filter(s => !args.preset || s.key === args.preset)
if (sources.length === 0) fail(`No preset called "${args.preset}". There are: ${presetsMod.MODDED_PRESET_SOURCES.map(s => s.key).join(', ')}`)

// ── SteamCMD ─────────────────────────────────────────────────────────────────

function steamcmdDownload(ids) {
  const wanted = [...new Set(ids)].filter(modCore.isWorkshopId)
  if (wanted.length === 0) return Promise.resolve({ done: [], failed: [] })
  if (!existsSync(steamcmd)) fail(`SteamCMD isn't at ${steamcmd}. Pass --steamcmd.`)
  const argv = ['+force_install_dir', install, '+login', 'anonymous', ...wanted.flatMap(id => ['+workshop_download_item', '108600', id]), '+quit']
  log(`SteamCMD: downloading ${wanted.length} Workshop items (anonymous)...`)
  return new Promise((res, rej) => {
    const proc = spawn(steamcmd, argv, { cwd: dirname(steamcmd), windowsHide: true })
    const done = new Set(), failed = new Map()
    let buf = ''
    const onData = d => {
      buf += d.toString()
      for (const m of buf.matchAll(/Success\. Downloaded item (\d+)/g)) done.add(m[1])
      for (const m of buf.matchAll(/ERROR! Download item (\d+) failed \(([^)]*)\)/g)) failed.set(m[1], m[2])
      if (buf.length > 100000) buf = buf.slice(-2000)
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', rej)
    proc.on('close', () => {
      // SteamCMD's console output comes in bursts; whatever is on disk counts
      const content = modScan.workshopContentDir(install)
      for (const id of wanted) if (!done.has(id) && !failed.has(id) && existsSync(join(content, id))) done.add(id)
      res({ done: [...done], failed: [...failed.entries()].map(([id, reason]) => ({ id, reason })) })
    })
  })
}

// ── Steam's public item details (the same keyless call the app makes) ───────

async function steamDetails(ids) {
  const out = new Map()
  const list = ids.filter(modCore.isWorkshopId)
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100)
    const body = [`itemcount=${batch.length}`, ...batch.map((id, n) => `publishedfileids[${n}]=${id}`)].join('&')
    const r = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    })
    if (!r.ok) throw new Error(`Steam returned ${r.status}`)
    const j = await r.json()
    for (const d of j?.response?.publishedfiledetails || []) {
      if (d.result !== 1 || !modCore.isWorkshopId(String(d.publishedfileid))) continue
      out.set(String(d.publishedfileid), {
        name: String(d.title || ''),
        thumbnailUrl: steamImageUrl(d.preview_url) || '',
        fileSize: Number(d.file_size || 0),
        updated: d.time_updated ? new Date(d.time_updated * 1000).toISOString().slice(0, 10) : null,
        subscriptions: Number(d.subscriptions || 0),
      })
    }
  }
  return out
}

// ── the preset as the app would have it after the downloads ─────────────────

async function localModFolders() {
  return modScan.scanModFolders(LOCAL_MODS)
}

const isLocalItem = item => 'local' in item

// One list entry per item, with the mod.info the files have now. Same shape the app keeps
// after it downloaded and scanned a mod (applyInfos), plus the details from Steam
async function entriesFor(source, details) {
  const content = modScan.workshopContentDir(install)
  const locals = await localModFolders()
  const problems = []
  const entries = []
  for (const item of source.items) {
    if (isLocalItem(item)) {
      const hit = locals.find(l => l.info.id === item.local)
      if (!hit) { problems.push(`fix mod ${item.local} isn't in local-mods/`); continue }
      entries.push(appMods.withEnabled({ workshopId: '', modId: item.local, name: item.name, infos: [hit.info] }, [item.local]))
      continue
    }
    const infos = await modScan.scanWorkshopItem(join(content, item.workshopId))
    if (infos.length === 0) { problems.push(`${item.workshopId} isn't downloaded (or has no mod.info)`); continue }
    const missing = item.mods.filter(id => !infos.some(i => i.id === id))
    if (missing.length) problems.push(`${item.workshopId} has no mod called ${missing.join(', ')} any more (it has ${infos.map(i => i.id).join(', ')})`)
    const d = details?.get(item.workshopId)
    entries.push(appMods.withEnabled({
      workshopId: item.workshopId,
      modId: item.mods.join(';'),
      name: d?.name || infos[0].name,
      ...(d?.thumbnailUrl ? { thumbnailUrl: d.thumbnailUrl } : {}),
      ...(d?.fileSize ? { fileSize: d.fileSize } : {}),
      infos,
    }, item.mods.filter(id => infos.some(i => i.id === id))))
  }
  return { entries, problems }
}

// Everything the Mods tab would warn about for this list (src/lib/mods.ts modWarningCount)
function listWarnings(mods) {
  const profile = { mods, buildVersion: 'b42' }
  const p = appMods.listProblems(profile)
  return [
    ...appMods.missingRequirements(profile).map(m => `${m.neededBy} needs ${m.id}, which isn't in the list`),
    ...appMods.disabledRequirements(profile).map(m => `${m.id} is needed but switched off`),
    ...mods.filter(appMods.needsChoice).map(m => `${m.name} has several mods inside and none picked`),
    ...p.order.map(o => o.kind === 'cycle' ? `load order loop: ${o.ids.join(' > ')}` : `${o.a} and ${o.b} say they don't work together`),
    ...p.wrongBuild.map(w => `${w.name} (${w.id}) only has files for ${w.builds.join('/')}`),
    ...(p.unsorted ? ['the list is not in load order (the app would say "mods are above something they have to load after")'] : []),
  ]
}

function readData() {
  try { return JSON.parse(readFileSync(DATA_FILE, 'utf-8')) } catch { return {} }
}
function writeData(data) {
  // same order as the presets in modPresets.ts, so diffs stay small
  const ordered = {}
  for (const s of presetsMod.MODDED_PRESET_SOURCES) if (data[s.key]) ordered[s.key] = data[s.key]
  writeFileSync(DATA_FILE, JSON.stringify(ordered, null, 2) + '\n', 'utf-8')
}

function serverBuildId() {
  try {
    const acf = readFileSync(join(install, 'steamapps', 'appmanifest_380870.acf'), 'utf-8')
    return acf.match(/"buildid"\s+"(\d+)"/i)?.[1] || ''
  } catch { return '' }
}

// ── refresh ──────────────────────────────────────────────────────────────────

async function refresh() {
  const ids = sources.flatMap(s => s.items.filter(i => !isLocalItem(i)).map(i => i.workshopId))
  if (args.download !== false) {
    const dl = await steamcmdDownload(ids)
    if (dl.failed.length) fail(`These didn't download: ${dl.failed.map(f => `${f.id} (${f.reason})`).join(', ')}`)
  }
  const details = await steamDetails(ids)
  const data = readData()
  let bad = false
  for (const source of sources) {
    const { entries, problems } = await entriesFor(source, details)
    const { sorted, moves } = modCore.sortModList(entries)
    const warnings = listWarnings(sorted)
    const bytes = sorted.reduce((n, m) => n + (m.workshopId ? m.fileSize || 0 : 0), 0)
    log(`${source.label}: ${sorted.length} mods, ${(bytes / 1048576).toFixed(0)} MB${moves.length ? `, sorted (${moves.length} moved)` : ''}`)
    for (const p of [...problems, ...warnings]) { console.log(`   ! ${p}`); bad = true }
    for (const m of sorted.filter(m => m.workshopId)) {
      const d = details.get(m.workshopId)
      if (d) console.log(`   ${m.workshopId}  updated ${d.updated}  ${String(d.subscriptions).padStart(8)} subs  ${(d.fileSize / 1048576).toFixed(1).padStart(6)} MB  ${d.name}`)
      else { console.log(`   ${m.workshopId}  Steam doesn't know this item (removed or private?)`); bad = true }
    }
    data[source.key] = { mods: sorted, downloadBytes: bytes, ...(data[source.key]?.verified ? { verified: data[source.key].verified } : {}) }
  }
  writeData(data)
  log(`Wrote ${relative(ROOT, DATA_FILE)}`)
  if (bad) fail('Some presets have problems, see the ! lines above.')
}

// ── a test start ─────────────────────────────────────────────────────────────

// StartServer64.bat's java line, with our memory and without its %1 %2. Read from the bat so
// changes to it in a game update carry over
function javaCommand() {
  const bat = readFileSync(join(install, 'StartServer64.bat'), 'utf-8')
  const cp = bat.match(/SET\s+PZ_CLASSPATH=(\S+)/i)?.[1] || 'java/;java/projectzomboid.jar'
  const line = bat.split(/\r?\n/).find(l => /java\.exe/i.test(l))
  if (!line) fail("Couldn't find the java line in StartServer64.bat")
  const exe = line.match(/^"?([^"]*java\.exe)"?/i)[1]
  const rest = line.slice(line.toLowerCase().indexOf('java.exe') + 'java.exe'.length).replace(/^"/, '')
  const parts = rest.split(/\s+/).filter(Boolean).filter(p => !/^%\d$/.test(p))
    .map(p => p.replace('%PZ_CLASSPATH%', cp))
    .map(p => p.replace(/^-Xms\d+[mMgG]?$/, `-Xms${memoryMb}m`).replace(/^-Xmx\d+[mMgG]?$/, `-Xmx${memoryMb}m`))
  return { exe: resolve(install, exe), args: parts }
}

function killTree(pid) {
  return new Promise(res => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => res()))
}

let running = null
process.on('SIGINT', async () => { if (running) await killTree(running.pid); process.exit(130) })

// mods: the list as the app would write it (sorted, scanned); empty for the vanilla start
async function testStart(label, key, mods, preset) {
  const cache = join(work, `${cachePrefix}${key}`)
  rmSync(cache, { recursive: true, force: true })
  mkdirSync(join(cache, 'Server'), { recursive: true })
  const serverName = `knoxcheck_${key.replace(/[^a-zA-Z0-9]/g, '_')}`

  // fix mods go in <data>\mods, the same as the app does (localMods.ts)
  const locals = await localModFolders()
  for (const id of preset?.localMods || []) {
    const hit = locals.find(l => l.info.id === id)
    if (!hit) throw new Error(`fix mod ${id} isn't in local-mods/`)
    cpSync(join(LOCAL_MODS, hit.folder), join(cache, 'mods', hit.folder), { recursive: true, filter: src => basename(src) !== '.gitkeep' })
    mkdirSync(join(cache, 'mods', hit.folder, 'common'), { recursive: true })
  }

  // the .ini and sandbox the app writes (serverManager iniSettingsFor / writeProfileSandbox)
  const ini = {
    ...(preset?.iniSettings || {}),
    PVP: false,
    PublicName: `Knox check ${label}`,
    Public: false,
    // a test server shouldn't open ports on the router
    UPnP: false,
    DefaultPort: port,
    UDPPort: port + 1,
    RCONPort: port + 2,
    RCONPassword: randomBytes(9).toString('hex'),
    MaxPlayers: 8,
    Password: '',
    WorkshopItems: mods.map(m => m.workshopId).filter(modCore.isWorkshopId).join(';'),
    Mods: modCore.formatModIds(modCore.orderModIds(mods).order, 'b42'),
    Map: modCore.buildMapLine(mods, preset?.iniSettings?.Map ? String(preset.iniSettings.Map) : undefined),
  }
  writeFileSync(join(cache, 'Server', `${serverName}.ini`), gameConfig.mergeIni('', ini), 'utf-8')
  writeFileSync(join(cache, 'Server', `${serverName}_SandboxVars.lua`), gameConfig.mergeSandbox('', preset?.sandboxSettings || {}, true), 'utf-8')

  const java = javaCommand()
  const argv = [...java.args, '-servername', serverName, `-cachedir=${cache}`, '-adminpassword', randomBytes(9).toString('hex')]
  log(`${label}: starting the server (port ${port}, ${memoryMb} MB, data in ${cache})`)
  const t0 = Date.now()
  const proc = spawn(java.exe, argv, { cwd: install, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  running = proc
  const stdout = []
  proc.stdout.on('data', d => { if (stdout.length < 20000) stdout.push(d.toString()) })
  proc.stderr.on('data', d => { if (stdout.length < 20000) stdout.push(d.toString()) })
  let exited = null
  proc.on('exit', code => { exited = code ?? -1 })

  const logPath = join(cache, 'server-console.txt')
  let offset = 0
  let partial = ''
  let started = false
  let fatal = null
  const readNew = () => {
    if (!existsSync(logPath)) return
    const size = statSync(logPath).size
    if (size <= offset) return
    const buf = Buffer.alloc(size - offset)
    const fd = openSync(logPath, 'r')
    try { readSync(fd, buf, 0, buf.length, offset) } finally { closeSync(fd) }
    offset = size
    const text = partial + buf.toString('utf-8')
    const lines = text.split(/\r?\n/)
    partial = lines.pop()
    for (const l of lines) {
      if (logCheck.READY_LINE.test(l)) started = true
      if (!fatal && /Server Terminated\.|WorldDictionaryException|GameServer\.main>.*Exception thrown/.test(l)) fatal = l.trim()
    }
  }
  while (!started && !fatal && exited === null && Date.now() - t0 < timeoutS * 1000) {
    await new Promise(r => setTimeout(r, 2000))
    readNew()
  }
  const startedIn = Math.round((Date.now() - t0) / 1000)
  if (started) {
    log(`${label}: SERVER STARTED after ${startedIn}s, letting it run a little longer`)
    // server-side Lua that runs once the world is up (OnServerStarted, first ticks) gets a chance to complain
    await new Promise(r => setTimeout(r, 20000))
  } else if (fatal) log(`${label}: the start failed after ${startedIn}s: ${fatal}`)
  else if (exited !== null) log(`${label}: java quit after ${startedIn}s (exit code ${exited}) without starting`)
  else log(`${label}: didn't start within ${timeoutS}s`)

  // stop: "quit" on the console saves and shuts down, like typing it in the server window
  if (exited === null) {
    try { proc.stdin.write('quit\n') } catch { /* already closing */ }
    const t1 = Date.now()
    while (exited === null && Date.now() - t1 < 90000) await new Promise(r => setTimeout(r, 1000))
    if (exited === null) { log(`${label}: didn't stop by itself, ending it`); await killTree(proc.pid) }
    else log(`${label}: stopped (${Math.round((Date.now() - t1) / 1000)}s)`)
  }
  running = null
  readNew()
  const lines = existsSync(logPath) ? readFileSync(logPath, 'utf-8').split(/\r?\n/) : stdout.join('').split(/\r?\n/)
  writeFileSync(join(cache, 'stdout.txt'), stdout.join(''), 'utf-8')
  return { started, fatal, exited, startedIn, lines, logPath, cache, serverName }
}

// which mod a path like media/scripts/vehicles/foo.txt comes from (for errors that only
// name a file)
function fileIndex(mods) {
  const content = modScan.workshopContentDir(install)
  const index = new Map()
  const walk = (dir, label, base) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, label, base)
      else {
        const rel = relative(base, p).replace(/\\/g, '/').toLowerCase()
        if (!index.has(rel)) index.set(rel, label)
      }
    }
  }
  for (const m of mods.filter(m => m.workshopId)) {
    for (const modDir of modScan.listDirs(join(content, m.workshopId, 'mods'))) {
      const root = join(content, m.workshopId, 'mods', modDir)
      for (const sub of ['', ...modScan.listDirs(root)]) {
        const base = join(root, sub)
        if (existsSync(join(base, 'media'))) walk(join(base, 'media'), m.name, base)
      }
    }
  }
  return rel => index.get(rel.toLowerCase())
}

function logModsFor(mods) {
  return mods.map(m => ({
    label: m.name,
    workshopId: m.workshopId || undefined,
    ids: modCore.enabledIds(m).concat((m.infos || []).map(i => i.id)),
    names: (m.infos || []).map(i => i.name),
    folders: m.workshopId ? modScan.listDirs(join(modScan.workshopContentDir(install), m.workshopId, 'mods')) : (m.infos || []).map(i => i.id),
  }))
}

async function verify() {
  const data = readData()
  const buildId = serverBuildId()
  const results = { date: new Date().toISOString(), install, buildId, gameVersion: null, presets: [] }
  const outDir = resolve(args.out ? dirname(args.out) : work)
  mkdirSync(outDir, { recursive: true })

  const ids = sources.flatMap(s => s.items.filter(i => !isLocalItem(i)).map(i => i.workshopId))
  let downloadFailed = []
  if (args.download !== false) downloadFailed = (await steamcmdDownload(ids)).failed

  let baseline = new Set()
  if (args.baseline !== false) {
    const v = await testStart('vanilla (no mods)', 'vanilla', [], null)
    if (!v.started) fail(`The server doesn't even start without mods (${v.fatal || `exit ${v.exited}`}). Check the install. Log: ${v.logPath}`)
    baseline = logCheck.baselineSignatures(v.lines)
    results.gameVersion = v.lines.map(l => l.match(/version=(\d+\.\d+(?:\.\d+)?)/)?.[1]).find(Boolean) || null
    results.vanilla = { startedIn: v.startedIn, errorLines: baseline.size }
    log(`vanilla: ${baseline.size} kinds of error line the game prints by itself (those don't count against mods)`)
  }

  for (const source of sources) {
    const preset = presetsMod.MODDED_PRESETS.find(p => p.key === source.key)
    const { entries, problems } = await entriesFor(source, null)
    // the app sorts before it starts (orderModIds), the list stays as saved
    const mods = entries.map(e => ({ ...e, name: preset.mods.find(m => m.workshopId === e.workshopId && m.modId === e.modId)?.name || e.name }))
    const warnings = [...problems, ...listWarnings(preset.mods.length === mods.length ? sortedLike(preset.mods, mods) : mods)]
    const run = await testStart(source.label, source.key, mods, preset)
    const report = logCheck.scanServerLog(run.lines, { mods: logModsFor(mods), baseline, ownerOfFile: fileIndex(mods) })
    const gameVersion = run.lines.map(l => l.match(/version=(\d+\.\d+(?:\.\d+)?)/)?.[1]).find(Boolean) || results.gameVersion
    results.gameVersion ||= gameVersion
    const ok = logCheck.startPassed(report) && warnings.length === 0 && !downloadFailed.some(f => ids.includes(f.id))
    const kept = join(outDir, `${source.key}-server-console.txt`)
    try { copyFileSync(run.logPath, kept) } catch { /* no log at all */ }
    const r = {
      key: source.key, label: source.label, ok, gameVersion, buildId,
      mods: preset.mods.length, workshopItems: preset.mods.filter(m => m.workshopId).length, localMods: preset.localMods,
      downloadBytes: preset.downloadBytes, startedIn: run.started ? run.startedIn : null,
      fatal: report.fatal || (run.started ? null : run.exited !== null ? `java exited with ${run.exited}` : `no start within ${timeoutS}s`),
      listWarnings: warnings, exceptions: report.exceptions, noise: report.noise, sameAsVanilla: report.baseline,
      errorsByMod: report.groups, log: kept,
    }
    results.presets.push(r)
    log(`${source.label}: ${ok ? 'OK' : 'NOT OK'}${report.exceptions ? `, ${report.exceptions} script exceptions` : ''}, ${report.groups.reduce((n, g) => n + g.errors.length, 0)} other kinds of error line, ${report.noise} noise lines`)
    for (const w of warnings) console.log(`   ! ${w}`)
    for (const g of report.groups) {
      console.log(`   ${g.mod}${g.exceptions ? ` (${g.exceptions} exceptions)` : ''}`)
      for (const e of g.errors.slice(0, 5)) console.log(`      ${e.count}x ${e.text.slice(0, 180)}`)
      if (g.errors.length > 5) console.log(`      ...and ${g.errors.length - 5} more`)
    }
    if (args.update) {
      data[source.key] = { ...(data[source.key] || {}), verified: { gameVersion: gameVersion || 'unknown', buildId, date: results.date.slice(0, 10), ok } }
    }
  }

  const outFile = resolve(args.out || join(outDir, `preset-check-${results.date.slice(0, 10)}.json`))
  writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf-8')
  log(`Results: ${outFile}`)
  if (args.update) { writeData(data); log(`Updated "verified" in ${relative(ROOT, DATA_FILE)}`) }
  if (results.presets.some(p => !p.ok)) process.exitCode = 2
}

// the preset's saved order with the freshly scanned mod.info, to check the saved order still holds
function sortedLike(saved, fresh) {
  return saved.map(s => fresh.find(f => f.workshopId === s.workshopId && f.modId === s.modId) || s)
}

if (command === 'refresh') await refresh()
else await verify()
