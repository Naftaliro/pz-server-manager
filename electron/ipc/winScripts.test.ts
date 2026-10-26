import { describe, it, expect } from 'vitest'
import { spawn, execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  batText, quotedValue, patchStartBat, launcherScript, updateScript,
  serverWindowCommand, updaterWindowCommand, sendKeysScript,
  firewallScript, firewallRemoveScript, firewallQueryScript, firewallState, FIREWALL_RULE, OLD_FIREWALL_RULE,
  type FirewallRuleInfo,
} from './winScripts'

const STOCK_BAT = [
  '@setlocal enableextensions',
  '@cd /d "%~dp0"',
  'SET PZ_CLASSPATH=java/;java/projectzomboid.jar',
  '".\\jre64\\bin\\java.exe" -Djava.awt.headless=true -Xms16g -Xmx16g -cp %PZ_CLASSPATH% zombie.network.GameServer -statistic 0 %1 %2',
  'PAUSE',
].join('\r\n')

describe('batText / quotedValue', () => {
  it('doubles % so cmd keeps it', () => {
    expect(batText('C:\\100% done\\%PATH%')).toBe('C:\\100%% done\\%%PATH%%')
  })

  it('doubles backslashes only right before the closing quote', () => {
    expect(quotedValue('C:\\dir\\')).toBe('C:\\dir\\\\')
    expect(quotedValue('a\\b')).toBe('a\\b')
  })
})

describe('patchStartBat', () => {
  it('forwards every argument plus the admin password variable and drops PAUSE', () => {
    const out = patchStartBat(STOCK_BAT)
    expect(out).toContain('-statistic 0 %* -adminpassword "%PZM_ADMINPW%"')
    expect(out).not.toMatch(/PAUSE/i)
    expect(out).toContain('-Xmx16g')
  })

  it('swaps in the memory setting, but not anything under 1 GB', () => {
    expect(patchStartBat(STOCK_BAT, 6144)).toContain('-Xms6144m -Xmx6144m')
    expect(patchStartBat(STOCK_BAT, 512)).toContain('-Xms16g -Xmx16g')
  })
})

describe('launcherScript', () => {
  const lines = launcherScript({
    serverName: 'Main', serverDir: 'C:\\Users\\José\\100% PZ', startBat: '_pzm_StartServer64_Main.bat',
    adminPassword: '50%off\\', cacheDir: 'D:\\Zomboid',
  }).split('\r\n')

  it('switches to UTF-8 before the first path', () => {
    expect(lines.indexOf('chcp 65001 > nul')).toBeLessThan(lines.findIndex(l => l.startsWith('cd /d')))
    expect(lines).toContain('cd /d "C:\\Users\\José\\100%% PZ"')
  })

  it('keeps the password and data folder out of the call line', () => {
    expect(lines).toContain('set "PZM_ADMINPW=50%%off\\\\"')
    expect(lines).toContain('set "PZM_CACHEDIR=D:\\Zomboid"')
    expect(lines).toContain('call ".\\_pzm_StartServer64_Main.bat" -servername "Main" -cachedir="%%PZM_CACHEDIR%%"')
    expect(lines.join('\n')).not.toMatch(/delayedexpansion/i)
  })

  it('leaves -cachedir off for the default data folder', () => {
    const out = launcherScript({ serverName: 'Main', serverDir: 'C:\\PZServer', startBat: 's.bat', adminPassword: 'pw' })
    expect(out).not.toContain('cachedir')
    expect(out).toContain('call ".\\s.bat" -servername "Main"\r\n')
  })
})

describe('updateScript', () => {
  const out = updateScript({
    zipPath: "C:\\Users\\O'Neil 100%\\update.zip",
    extractDir: 'C:\\Users\\Łukasz!\\extracted',
    appExe: 'C:\\Users\\Łukasz!\\Programs\\Knox Launcher\\PZ Server Manager.exe',
  })

  it('switches to UTF-8 before the first path and never turns on delayed expansion', () => {
    expect(out.indexOf('chcp 65001')).toBeLessThan(out.indexOf('Łukasz'))
    expect(out).not.toMatch(/delayedexpansion/i)
  })

  it("escapes ' for powershell and % for cmd", () => {
    expect(out).toContain("-LiteralPath 'C:\\Users\\O''Neil 100%%\\update.zip'")
  })

  it('waits for the right exe and stops with an error instead of claiming success', () => {
    expect(out).toContain('tasklist /FI "IMAGENAME eq PZ Server Manager.exe"')
    expect(out).toContain('robocopy "%SRC%" "C:\\Users\\Łukasz!\\Programs\\Knox Launcher"')
    expect(out).toContain('if errorlevel 1 goto failed')
    expect(out.indexOf(':failed')).toBeGreaterThan(out.indexOf('exit /b 0'))
  })
})

describe('window commands', () => {
  it('only reach paths through variables', () => {
    const server = serverWindowCommand('PZ Server - Main', 'C:\\a (x86) & b', 'C:\\a (x86) & b\\_pzm_launch_Main.bat')
    expect(server.args).toBe('/d /c start "PZ Server - Main" /min /D "%PZM_DIR%" cmd.exe /d /k call "%PZM_LAUNCHER%"')
    expect(server.env).toEqual({ PZM_DIR: 'C:\\a (x86) & b', PZM_LAUNCHER: 'C:\\a (x86) & b\\_pzm_launch_Main.bat' })
    expect(updaterWindowCommand('C:\\x\\u.bat').args).not.toContain('C:\\')
  })
})

describe('sendKeysScript', () => {
  it("escapes SendKeys specials and ' but leaves quotes alone", () => {
    const s = sendKeysScript('PZ Server - Main', `servermsg "it's 50% (ok)"`)
    expect(s).toContain(`SendKeys('servermsg "it''s 50{%} {(}ok{)}"{ENTER}')`)
    expect(s).toContain("AppActivate('PZ Server - Main')")
  })
})

// The rest runs the real scripts the same way the app does, so only on Windows
// (the build runs these on windows-latest). Folder names with everything that broke
// the old ones: an accented name, ! and % that cmd treats specially, and ( ) & that
// make cmd drop the quotes around a path.
const TRICKY = 'Jos\u00e9 \u0141ukasz! 50% (x86) & co'

function waitFor(check: () => boolean, ms = 45000): Promise<boolean> {
  return new Promise((resolve) => {
    const end = Date.now() + ms
    const tick = () => {
      if (check()) return resolve(true)
      if (Date.now() > end) return resolve(false)
      setTimeout(tick, 250)
    }
    tick()
  })
}

// GitHub's build machines already run consoles in UTF-8, which hides the old bug. A typical
// PC starts them in an older code page, so force 437 (US) on the window titles we use
function legacyConsole(title: string): () => void {
  execFileSync('reg', ['add', `HKCU\\Console\\${title}`, '/v', 'CodePage', '/t', 'REG_DWORD', '/d', '437', '/f'])
  return () => { try { execFileSync('reg', ['delete', `HKCU\\Console\\${title}`, '/f']) } catch { /* already gone */ } }
}

describe.runIf(process.platform === 'win32')('on Windows', () => {
  it('starts the server with the password, data folder and memory intact', async () => {
    const base = join(mkdtempSync(join(tmpdir(), 'pzm-')), TRICKY)
    const serverDir = join(base, 'server')
    const cacheDir = join(base, 'Zomboid ^data')
    mkdirSync(serverDir, { recursive: true })
    mkdirSync(cacheDir, { recursive: true })
    // stands in for java: writes down exactly what it was started with
    writeFileSync(join(serverDir, 'record.js'),
      "require('fs').writeFileSync(require('path').join(__dirname, 'argv.json'), JSON.stringify(process.argv.slice(2)))")
    writeFileSync(join(serverDir, 'StartServer64.bat'),
      STOCK_BAT.replace('".\\jre64\\bin\\java.exe"', `"${process.execPath}" record.js`))

    const password = 'p@ss 50%off ^c! &|<>\u0141\u00f3d\u017a\\'
    writeFileSync(join(serverDir, '_pzm_StartServer64_pzmtest.bat'),
      patchStartBat(readFileSync(join(serverDir, 'StartServer64.bat'), 'utf-8'), 2048))
    const launcherPath = join(serverDir, '_pzm_launch_pzmtest.bat')
    writeFileSync(launcherPath, launcherScript({
      serverName: 'pzmtest', serverDir, startBat: '_pzm_StartServer64_pzmtest.bat', adminPassword: password, cacheDir,
    }))

    const restore = legacyConsole('PZ Server - pzmtest')
    try {
      const cmd = serverWindowCommand('PZ Server - pzmtest', serverDir, launcherPath)
      spawn('cmd.exe', [cmd.args], {
        cwd: serverDir, env: { ...process.env, ...cmd.env }, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
      }).unref()

      const argvPath = join(serverDir, 'argv.json')
      expect(await waitFor(() => existsSync(argvPath))).toBe(true)
      const argv: string[] = JSON.parse(readFileSync(argvPath, 'utf-8'))
      expect(argv).toContain('-Xms2048m')
      expect(argv.slice(argv.indexOf('-servername'))).toEqual([
        '-servername', 'pzmtest', `-cachedir=${cacheDir}`, '-adminpassword', password,
      ])
    } finally {
      restore()
    }
  }, 60000)

  it('puts the update in place and starts the app again', async () => {
    const base = join(mkdtempSync(join(tmpdir(), 'pzm-')), TRICKY)
    const appDir = join(base, 'Programs', 'Knox Launcher')
    const pkg = join(base, 'pkg')
    const work = join(base, 'pz-manager-update')
    for (const d of [join(appDir, 'resources'), join(pkg, 'resources'), work]) mkdirSync(d, { recursive: true })

    // a copy of cmd.exe stands in for the app: started with no arguments it just sits
    // at a prompt, so it shows up in tasklist once the updater relaunches it
    const exe = 'Knox Test.exe'
    writeFileSync(join(appDir, exe), 'old version')
    writeFileSync(join(appDir, 'resources', 'app.asar'), 'old')
    copyFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), join(pkg, exe))
    writeFileSync(join(pkg, 'resources', 'app.asar'), 'new')
    const zipPath = join(work, 'Knox.Launcher-9.9.9-win.zip')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path '${pkg.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}'`])

    const scriptPath = join(work, 'pz-update.bat')
    writeFileSync(scriptPath, updateScript({ zipPath, extractDir: join(work, 'extracted'), appExe: join(appDir, exe) }), 'utf-8')
    const restore = legacyConsole('Knox Launcher Updater')
    const cmd = updaterWindowCommand(scriptPath)
    spawn('cmd.exe', [cmd.args], {
      env: { ...process.env, ...cmd.env }, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true,
    }).unref()

    const running = () => execFileSync('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH']).toString().includes(exe)
    try {
      expect(await waitFor(running)).toBe(true)
      expect(readFileSync(join(appDir, 'resources', 'app.asar'), 'utf-8')).toBe('new')
      expect(await waitFor(() => !existsSync(scriptPath), 10000)).toBe(true)
    } finally {
      restore()
      try { execFileSync('taskkill', ['/IM', exe, '/F']) } catch { /* not running */ }
    }
  }, 90000)
})

describe('firewall', () => {
  const java = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Project Zomboid Dedicated Server\\jre64\\bin\\java.exe'

  it('replaces the old allow-everything rule with UDP game ports only', () => {
    const lines = firewallScript([{ program: java, ports: [16262, 16261, 16261, 16265, 16266] }]).split('\r\n')
    const del = lines.findIndex(l => l.includes(`delete rule name="${OLD_FIREWALL_RULE}"`))
    const add = lines.findIndex(l => l.includes('add rule'))
    expect(del).toBeGreaterThan(-1)
    expect(lines.some(l => l.includes(`delete rule name="${FIREWALL_RULE}"`))).toBe(true)
    expect(add).toBeGreaterThan(del)
    expect(lines[add]).toBe(`netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow program="${java}" protocol=UDP localport=16261,16262,16265,16266 enable=yes profile=any`)
    // nothing TCP, so RCON (TCP 27015+) stays closed
    expect(lines.join('\n')).not.toMatch(/protocol=TCP/)
  })

  it('makes one rule per server install and skips bad ports', () => {
    const out = firewallScript([
      { program: 'C:\\A\\java.exe', ports: [16261, 16262] },
      { program: 'D:\\100% B\\java.exe', ports: [0, 70000] },
    ])
    expect(out.match(/add rule/g)).toHaveLength(1)
    expect(firewallScript([{ program: 'D:\\100% B\\java.exe', ports: [1] }])).toContain('program="D:\\100%% B\\java.exe"')
  })

  it('remove only deletes our rules', () => {
    expect(firewallRemoveScript()).not.toMatch(/add rule/)
    expect(firewallRemoveScript()).toContain(`delete rule name="${OLD_FIREWALL_RULE}"`)
  })

  const rule = (over: Partial<FirewallRuleInfo> = {}): FirewallRuleInfo => ({
    name: FIREWALL_RULE, enabled: 'True', direction: 'Inbound', action: 'Allow', protocol: 'UDP',
    ports: ['16261', '16262'], program: java, ...over,
  })
  const needed = [{ program: java, ports: [16261, 16262] }]

  it('is up to date only when every server port is open and the old rule is gone', () => {
    expect(firewallState(needed, [rule()])).toEqual({ upToDate: true, oldRule: false, anyRule: true })
    expect(firewallState(needed, [rule({ program: java.toUpperCase() })]).upToDate).toBe(true)
    expect(firewallState(needed, [rule({ ports: ['16261'] })]).upToDate).toBe(false)
    expect(firewallState(needed, [rule({ enabled: 'False' })]).upToDate).toBe(false)
    expect(firewallState(needed, [rule(), rule({ name: OLD_FIREWALL_RULE, protocol: 'TCP', ports: ['Any'] })]))
      .toEqual({ upToDate: false, oldRule: true, anyRule: true })
    expect(firewallState(needed, [])).toEqual({ upToDate: false, oldRule: false, anyRule: false })
  })
})

describe.runIf(process.platform === 'win32')('firewall on Windows', () => {
  it('reads the rules without admin and in a shape the app understands', () => {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', firewallQueryScript()]).toString()
    const rules = JSON.parse(out) as FirewallRuleInfo[]
    expect(Array.isArray(rules)).toBe(true)
    for (const r of rules) {
      expect([FIREWALL_RULE, OLD_FIREWALL_RULE]).toContain(r.name)
      for (const k of ['enabled', 'direction', 'action', 'protocol', 'program'] as const) expect(typeof r[k]).toBe('string')
      expect(Array.isArray(r.ports)).toBe(true)
    }
  }, 30000)
})
