import { describe, it, expect } from 'vitest'
import { spawn, execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, openSync, readSync, closeSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  batText, quotedValue, patchStartBat, launcherScript, updateScript,
  serverWindowCommand, updaterWindowCommand, sendKeysScript,
  firewallScript, firewallRemoveScript, firewallQueryScript, firewallState, FIREWALL_RULE, OLD_FIREWALL_RULE,
  type FirewallRuleInfo, uninstallerFor, uninstallersFor, APP_EXE_NAMES, INSTALLER_UPDATE_ARGS, isNsisInstaller, folderSizeArgs, parseFolderSize,
  RELEASE_SIGNER, signatureQueryScript, signedByUs, type SignatureInfo,
  folderSignaturesScript, updatePackageProblem, expandArchiveScript, ARTIFACT_SIGNING_EKU, CODE_SIGNING_EKU, PS_UTF8_OUTPUT, psJson,
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
    sourceDir: "C:\\Users\\O'Neil 100%\\extracted",
    appExe: 'C:\\Users\\Łukasz!\\Programs\\Knox Launcher\\PZ Server Manager.exe',
  })

  it('switches to UTF-8 before the first path and never turns on delayed expansion', () => {
    expect(out.indexOf('chcp 65001')).toBeLessThan(out.indexOf('Łukasz'))
    expect(out).not.toMatch(/delayedexpansion/i)
  })

  it('only copies the folder the app already checked, escaping % for cmd', () => {
    expect(out).toContain('set "SRC=C:\\Users\\O\'Neil 100%%\\extracted"')
    expect(out).toContain('if not exist "%SRC%\\PZ Server Manager.exe" goto failed')
    // unpacking (and the signature check) happen in the app before this runs
    expect(out).not.toMatch(/Expand-Archive|powershell/i)
  })

  it("escapes ' for powershell when the app unpacks the zip", () => {
    expect(expandArchiveScript("C:\\Users\\O'Neil 100%\\update.zip", 'C:\\x'))
      .toContain("Expand-Archive -LiteralPath 'C:\\Users\\O''Neil 100%\\update.zip' -DestinationPath 'C:\\x' -Force")
  })

  it('waits for the right exe and stops with an error instead of claiming success', () => {
    expect(out).toContain('tasklist /FI "IMAGENAME eq PZ Server Manager.exe"')
    expect(out).toContain('robocopy "%SRC%" "C:\\Users\\Łukasz!\\Programs\\Knox Launcher"')
    expect(out).toContain('if errorlevel 1 goto failed')
    expect(out.indexOf(':failed')).toBeGreaterThan(out.indexOf('exit /b 0'))
  })

  it("doesn't delete anything when the exe keeps its name", () => {
    expect(out).not.toMatch(/\bdel \/f/)
    expect(out).toContain('start "" "C:\\Users\\Łukasz!\\Programs\\Knox Launcher\\PZ Server Manager.exe"')
  })

  describe('a copy from before the rename', () => {
    const renamed = updateScript({
      sourceDir: 'C:\\x\\extracted',
      appExe: 'D:\\Games\\Knox 100%\\PZ Server Manager.exe',
      newExeName: 'Knox Launcher.exe',
    })
    it('waits for either name to close', () => {
      expect(renamed).toContain('tasklist /FI "IMAGENAME eq PZ Server Manager.exe"')
      expect(renamed).toContain('tasklist /FI "IMAGENAME eq Knox Launcher.exe"')
    })
    it('checks for and starts the new exe, then removes the old one', () => {
      expect(renamed).toContain('if not exist "%SRC%\\Knox Launcher.exe" goto failed')
      expect(renamed).toContain('if exist "D:\\Games\\Knox 100%%\\Knox Launcher.exe" del /f /q "D:\\Games\\Knox 100%%\\PZ Server Manager.exe"')
      expect(renamed).toContain('start "" "D:\\Games\\Knox 100%%\\Knox Launcher.exe"')
      expect(renamed.indexOf('del /f')).toBeGreaterThan(renamed.indexOf(':copied'))
    })
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
    // the app unpacks it (and checks the signature) before writing the script
    const extracted = join(work, 'extracted')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', expandArchiveScript(zipPath, extracted)])
    expect(readFileSync(join(extracted, 'resources', 'app.asar'), 'utf-8')).toBe('new')

    const scriptPath = join(work, 'pz-update.bat')
    writeFileSync(scriptPath, updateScript({ sourceDir: extracted, appExe: join(appDir, exe) }), 'utf-8')
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

  it('moves a copy from before the rename over to the new exe name', async () => {
    const base = join(mkdtempSync(join(tmpdir(), 'pzm-')), TRICKY)
    const appDir = join(base, 'Knox')
    const extracted = join(base, 'extracted')
    for (const d of [join(appDir, 'resources'), join(extracted, 'resources')]) mkdirSync(d, { recursive: true })
    const oldExe = 'Knox Old Test.exe'
    const newExe = 'Knox New Test.exe'
    writeFileSync(join(appDir, oldExe), 'old version')
    copyFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), join(extracted, newExe))
    writeFileSync(join(extracted, 'resources', 'app.asar'), 'new')
    const scriptPath = join(base, 'pz-update.bat')
    writeFileSync(scriptPath, updateScript({ sourceDir: extracted, appExe: join(appDir, oldExe), newExeName: newExe }), 'utf-8')
    const cmd = updaterWindowCommand(scriptPath)
    spawn('cmd.exe', [cmd.args], {
      env: { ...process.env, ...cmd.env }, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true,
    }).unref()
    const running = () => execFileSync('tasklist', ['/FI', `IMAGENAME eq ${newExe}`, '/NH']).toString().includes(newExe)
    try {
      expect(await waitFor(running)).toBe(true)
      expect(existsSync(join(appDir, newExe))).toBe(true)
      expect(existsSync(join(appDir, oldExe))).toBe(false)
      expect(readFileSync(join(appDir, 'resources', 'app.asar'), 'utf-8')).toBe('new')
    } finally {
      try { execFileSync('taskkill', ['/IM', newExe, '/F']) } catch { /* not running */ }
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

describe('installer updates', () => {
  it('finds the uninstaller electron-builder puts next to the installed exe', () => {
    expect(uninstallerFor('C:\\Users\\Me\\AppData\\Local\\Programs\\pz-server-manager\\Knox Launcher.exe'))
      .toBe('C:\\Users\\Me\\AppData\\Local\\Programs\\pz-server-manager\\Uninstall Knox Launcher.exe')
  })

  it('knows the uninstaller under both exe names (the 1.6 rename)', () => {
    const dir = 'C:\\Users\\Me\\AppData\\Local\\Programs\\pz-server-manager'
    for (const exe of APP_EXE_NAMES) {
      expect(uninstallersFor(`${dir}\\${exe}`).sort()).toEqual([`${dir}\\Uninstall Knox Launcher.exe`, `${dir}\\Uninstall PZ Server Manager.exe`])
    }
  })

  it('runs the installer silently as an update and restarts the app', () => {
    expect(INSTALLER_UPDATE_ARGS).toEqual(['/S', '--updated', '--force-run'])
  })

  const pe = (extra = '') => {
    const b = Buffer.alloc(0x200 + extra.length)
    b.write('MZ', 0, 'latin1')
    b.writeUInt32LE(0x80, 0x3c)
    b.write('PE\0\0', 0x80, 'latin1')
    b.write(extra, 0x200, 'latin1')
    return b
  }

  it('only takes a Windows program that is an NSIS installer', () => {
    expect(isNsisInstaller(pe('\xef\xbe\xad\xdeNullsoftInst'))).toBe(true)
    expect(isNsisInstaller(pe())).toBe(false)
    expect(isNsisInstaller(Buffer.from('PK\x03\x04NullsoftInst', 'latin1'))).toBe(false)
    expect(isNsisInstaller(Buffer.from('MZ'))).toBe(false)
  })

  // what an Artifact Signing signature on a release looks like (city and state made up: they
  // aren't checked, the certificate changes every few days anyway)
  const ours: SignatureInfo = {
    status: 'Valid', signer: RELEASE_SIGNER, timestamped: true,
    subject: [`CN=${RELEASE_SIGNER}`, `O=${RELEASE_SIGNER}`, 'L=Springfield', 'S=Oregon', 'C=US'],
    issuer: 'Microsoft ID Verified CS EOC CA 03',
    eku: [CODE_SIGNING_EKU, ARTIFACT_SIGNING_EKU, '1.3.6.1.4.1.311.97.990309390.766961637.194916062.941502583'],
  }

  it('only runs an installer Windows says is validly signed by the release signer', () => {
    expect(signedByUs(ours)).toBe(true)
    // Microsoft's other ID-verified CAs (and new ones) are fine
    for (const issuer of ['Microsoft ID Verified CS AOC CA 01', 'Microsoft ID Verified CS AOC CA 04', 'Microsoft ID Verified CS EOC CA 02']) {
      expect(signedByUs({ ...ours, issuer })).toBe(true)
    }
    expect(signedByUs({ ...ours, signer: 'Someone Else' })).toBe(false)
    expect(signedByUs({ ...ours, status: 'HashMismatch' })).toBe(false)
    expect(signedByUs({ ...ours, status: 'NotTrusted' })).toBe(false)
    expect(signedByUs({ status: 'NotSigned', signer: '' })).toBe(false)
  })

  // security review F9: a certificate with the same name from somewhere else doesn't pass
  it('checks more than the name', () => {
    expect(signedByUs({ ...ours, timestamped: false })).toBe(false)
    expect(signedByUs({ ...ours, timestamped: undefined })).toBe(false)
    expect(signedByUs({ ...ours, issuer: 'DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1' })).toBe(false)
    expect(signedByUs({ ...ours, issuer: 'Evil CA Microsoft ID Verified CS EOC CA 01' })).toBe(false)
    expect(signedByUs({ ...ours, subject: [`CN=${RELEASE_SIGNER}`, 'O=Someone Else Ltd'] })).toBe(false)
    expect(signedByUs({ ...ours, subject: [`CN=${RELEASE_SIGNER}`] })).toBe(false)
    expect(signedByUs({ ...ours, subject: [`CN=${RELEASE_SIGNER} Jr`, `O=${RELEASE_SIGNER}`] })).toBe(false)
    expect(signedByUs({ ...ours, eku: [CODE_SIGNING_EKU] })).toBe(false)
    expect(signedByUs({ ...ours, eku: [ARTIFACT_SIGNING_EKU] })).toBe(false)
    // what the old check looked at, alone
    expect(signedByUs({ status: 'Valid', signer: RELEASE_SIGNER })).toBe(false)
  })

  it("escapes ' in the path for powershell", () => {
    expect(signatureQueryScript("C:\\Users\\O'Brien\\setup.exe")).toContain("-LiteralPath 'C:\\Users\\O''Brien\\setup.exe'")
    expect(folderSignaturesScript("C:\\Users\\O'Brien\\extracted")).toContain("-LiteralPath 'C:\\Users\\O''Brien\\extracted'")
  })

  // security review F6: the portable zip gets the same check as the installer
  describe('portable update package', () => {
    const exe = 'C:\\update\\extracted\\PZ Server Manager.exe'
    const file = (name: string, sig: Partial<SignatureInfo>): SignatureInfo => ({ status: 'NotSigned', signer: '', ...sig, path: `C:\\update\\extracted\\${name}` })

    it('goes in when the exe is ours and nothing else has a broken signature', () => {
      expect(updatePackageProblem([file('PZ Server Manager.exe', ours), file('ffmpeg.dll', {}), file('d3dcompiler_47.dll', { status: 'Valid', signer: 'Microsoft Corporation' })], exe)).toBeNull()
      // paths compare the way Windows does
      expect(updatePackageProblem([{ ...ours, path: 'c:\\UPDATE\\extracted\\pz server manager.exe' }], exe)).toBeNull()
    })

    it("stops when the exe isn't there, isn't ours, or something was changed after signing", () => {
      expect(updatePackageProblem([file('ffmpeg.dll', {})], exe)).toMatch(/doesn't have PZ Server Manager.exe/)
      expect(updatePackageProblem([file('PZ Server Manager.exe', {})], exe)).toMatch(/isn't signed by/)
      expect(updatePackageProblem([file('PZ Server Manager.exe', { ...ours, status: 'HashMismatch' })], exe)).toMatch(/isn't signed by/)
      expect(updatePackageProblem([file('PZ Server Manager.exe', { ...ours, signer: 'Mallory', subject: ['CN=Mallory', 'O=Mallory'] })], exe)).toMatch(/isn't signed by/)
      expect(updatePackageProblem([file('PZ Server Manager.exe', ours), file('libEGL.dll', { status: 'HashMismatch', signer: 'Google LLC' })], exe)).toMatch(/libEGL.dll .* broken signature \(HashMismatch\)/)
      expect(updatePackageProblem([], exe)).not.toBeNull()
    })

    it('finds the exe by where it is in the unpacked folder, whatever letters the path has', () => {
      const root = 'C:\\Users\\Jürgen\\AppData\\Local\\pz-manager-update\\extracted'
      // the user's name came back mangled, the part inside the folder didn't
      const sig = { ...ours, path: 'C:\\Users\\J\uFFFDrgen\\AppData\\Local\\pz-manager-update\\extracted\\PZ Server Manager.exe', rel: 'PZ Server Manager.exe' }
      expect(updatePackageProblem([sig], `${root}\\PZ Server Manager.exe`, root)).toBeNull()
      expect(updatePackageProblem([{ ...sig, rel: 'pz server manager.EXE' }], `${root}\\PZ Server Manager.exe`, root)).toBeNull()
      // one of ours further down doesn't count as the one at the top
      expect(updatePackageProblem([{ ...sig, rel: 'resources\\PZ Server Manager.exe' }], `${root}\\PZ Server Manager.exe`, root)).toMatch(/doesn't have/)
      // without rel, the full path still works
      expect(updatePackageProblem([{ ...ours, path: `${root}\\PZ Server Manager.exe` }], `${root}\\PZ Server Manager.exe`, root)).toBeNull()
    })
  })

  it('switches PowerShell output to UTF-8 in every script whose output the app reads', () => {
    for (const script of [signatureQueryScript('C:\\a.exe'), folderSignaturesScript('C:\\a'), firewallQueryScript(), expandArchiveScript('C:\\a.zip', 'C:\\a')]) {
      expect(script).toContain(PS_UTF8_OUTPUT)
    }
    expect(psJson('\uFEFF{"a":1}')).toEqual({ a: 1 })
  })
})

describe.runIf(process.platform === 'win32')('signatures on Windows', () => {
  // the way the app runs them: PowerShell in a hidden console of its own, which is in the PC's
  // old code page. Forced to 437 here, so a console running the tests in UTF-8 can't hide a
  // script that doesn't switch its output to UTF-8 itself
  const run = (script: string, env: NodeJS.ProcessEnv = process.env) =>
    psJson(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(437); ${script}`], { env, windowsHide: true }))
  const signature = (file: string, env?: NodeJS.ProcessEnv) => run(signatureQueryScript(file), env) as SignatureInfo

  it("reads everything signedByUs looks at from a signed program, and someone else's doesn't pass", () => {
    // node.exe, signed by the OpenJS Foundation
    const sig = signature(process.execPath)
    expect(sig.status).toBe('Valid')
    expect(sig.signer).not.toBe('')
    expect(sig.subject).toContain(`CN=${sig.signer}`)
    expect(sig.subject!.some(p => p.startsWith('O='))).toBe(true)
    expect(sig.issuer).toMatch(/\S/)
    expect(sig.timestamped).toBe(true)
    expect(sig.eku).toContain(CODE_SIGNING_EKU)
    expect(signedByUs(sig)).toBe(false)
  }, 30000)

  it('reads an unsigned file in a folder with awkward characters', () => {
    // a German, a Russian and a Chinese user name: none of them survive code page 437
    const dir = mkdtempSync(join(tmpdir(), "pzm sig it's ü Жора 张伟-"))
    const file = join(dir, 'unsigned.ps1')
    writeFileSync(file, 'Write-Output 1\r\n')
    expect(signature(file)).toEqual({ path: file, status: 'NotSigned', signer: '', subject: [], issuer: '', timestamped: false, eku: [] })
  }, 30000)

  // started from PowerShell 7, the app's powershell.exe inherits a module path with 7's modules
  // first. The checks load Windows PowerShell's own copy, so a module path like that (here a
  // stand-in copy that refuses to load) can't get in the way
  it('still works with a PowerShell 7 style module path in front', () => {
    expect(signatureQueryScript('C:\\a.exe')).toMatch(/^\$ErrorActionPreference = 'Stop'; Import-Module \(Join-Path \$PSHOME 'Modules\\Microsoft\.PowerShell\.Security'\);/)
    expect(folderSignaturesScript('C:\\a')).toMatch(/^\$ErrorActionPreference = 'Stop'; Import-Module \(Join-Path \$PSHOME 'Modules\\Microsoft\.PowerShell\.Security'\);/)
    expect(expandArchiveScript('C:\\a.zip', 'C:\\a')).toMatch(/^\$ErrorActionPreference = 'Stop'; Import-Module \(Join-Path \$PSHOME 'Modules\\Microsoft\.PowerShell\.Archive'\);/)
    const fake = mkdtempSync(join(tmpdir(), 'pzm-ps7-'))
    for (const m of ['Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Archive']) {
      mkdirSync(join(fake, m), { recursive: true })
      writeFileSync(join(fake, m, `${m}.psm1`), "throw 'this is PowerShell 7s copy'\r\n")
    }
    const env = { ...process.env, PSModulePath: `${fake};${process.env.PSModulePath || ''}` }
    expect(signature(process.execPath, env).status).toBe('Valid')
    const zipDir = mkdtempSync(join(tmpdir(), 'pzm-ps7zip-'))
    writeFileSync(join(zipDir, 'a.txt'), 'x')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -LiteralPath '${join(zipDir, 'a.txt')}' -DestinationPath '${join(zipDir, 'a.zip')}'`])
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', expandArchiveScript(join(zipDir, 'a.zip'), join(zipDir, 'out'))], { env })
    expect(readFileSync(join(zipDir, 'out', 'a.txt'), 'utf-8')).toBe('x')
  }, 60000)

  it('checks every program and library in an unpacked update, and spots one changed after signing', () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pzm upd it's ü Жора 张伟-")), 'app')
    mkdirSync(join(dir, 'resources'), { recursive: true })
    copyFileSync(process.execPath, join(dir, 'PZ Server Manager.exe'))
    // an unsigned program, like Electron's own libraries: node.exe with its signature taken off
    // (the security entry in the PE header cleared, the certificate table cut off the end)
    const plain = readFileSync(process.execPath)
    const pe = plain.readUInt32LE(0x3c)
    const security = pe + 24 + (plain.readUInt16LE(pe + 24) === 0x20b ? 112 : 96) + 4 * 8
    const certAt = plain.readUInt32LE(security)
    plain.writeUInt32LE(0, security)
    plain.writeUInt32LE(0, security + 4)
    writeFileSync(join(dir, 'ffmpeg.dll'), plain.subarray(0, certAt))
    writeFileSync(join(dir, 'resources', 'app.asar'), 'not checked')
    // a signed program with one byte changed: Windows says HashMismatch
    const tampered = readFileSync(process.execPath)
    tampered[0x2000] ^= 0xff
    writeFileSync(join(dir, 'resources', 'helper.exe'), tampered)
    const sigs = run(folderSignaturesScript(dir)) as SignatureInfo[]
    const byName = Object.fromEntries(sigs.map(s => [s.rel, s.status]))
    expect(byName).toEqual({ 'PZ Server Manager.exe': 'Valid', 'ffmpeg.dll': 'NotSigned', 'resources\\helper.exe': 'HashMismatch' })
    // the full path can spell the temp folder differently (C:\Users\RUNNER~1 vs C:\Users\runneradmin),
    // which is why the update check goes by rel
    for (const s of sigs) expect(s.path!.toLowerCase().endsWith('\\' + s.rel!.toLowerCase())).toBe(true)
    // node.exe isn't ours, so this update wouldn't go in either way
    expect(updatePackageProblem(sigs, sigs.find(s => s.rel === 'PZ Server Manager.exe')!.path!)).toMatch(/isn't signed by/)
    expect(updatePackageProblem(sigs, join(dir, 'PZ Server Manager.exe'), dir)).toMatch(/isn't signed by/)
  }, 90000)
})

// the real thing, when a build has been made on this PC
describe.runIf(process.platform === 'win32')('installer updates on Windows', () => {
  const release = join(__dirname, '..', '..', 'release')
  const head = (f: string) => { const b = Buffer.alloc(1024 * 1024); const fd = openSync(f, 'r'); const n = readSync(fd, b, 0, b.length, 0); closeSync(fd); return b.subarray(0, n) }
  const built = existsSync(release) ? readdirSync(release) : []
  const setup = built.find(f => /-Setup-[\d.]+\.exe$/i.test(f))
  const zip = built.find(f => /-win\.zip$/i.test(f))

  it.runIf(!!setup)('recognises the real installer', () => {
    expect(isNsisInstaller(head(join(release, setup!)))).toBe(true)
  })
  it.runIf(!!zip)('and not the portable zip or the app exe', () => {
    expect(isNsisInstaller(head(join(release, zip!)))).toBe(false)
    for (const name of APP_EXE_NAMES) {
      const exe = join(release, 'win-unpacked', name)
      if (existsSync(exe)) expect(isNsisInstaller(head(exe))).toBe(false)
    }
  })
})

describe('folder sizes', () => {
  // what robocopy prints with /NFL /NDL /NJH, once in English and once in French
  const english = [
    '------------------------------------------------------------------------------',
    '',
    '               Total    Copied   Skipped  Mismatch    FAILED    Extras',
    '    Dirs :         5         5         0         0         0         0',
    '   Files :     87719     87719         0         0         0         0',
    '   Bytes : 226865399 226865399         0         0         0         0',
    '   Times :   0:00:00   0:00:00                       0:00:00   0:00:00',
    '   Ended : Monday, October 26, 2026 7:40:01 PM',
  ].join('\r\n')
  const french = english.replace('Dirs :', 'Rép. :').replace('Files :', 'Fichiers :').replace('Bytes :', 'Octets :')

  it('reads the byte total in any language', () => {
    expect(parseFolderSize(english)).toBe(226865399)
    expect(parseFolderSize(french)).toBe(226865399)
  })
  it('gives up on output it does not recognise', () => {
    expect(parseFolderSize('ERROR 2 (0x00000002) Accessing Source Directory C:\\nope\\')).toBeNull()
    expect(parseFolderSize('')).toBeNull()
  })
  it('lists only, never copies', () => {
    const args = folderSizeArgs('C:\\Users\\Me\\Zomboid\\Saves\\Multiplayer\\VAN')
    expect(args.slice(0, 3)).toEqual(['C:\\Users\\Me\\Zomboid\\Saves\\Multiplayer\\VAN', 'NUL', '/L'])
    expect(args).toContain('/BYTES')
  })
})

describe.runIf(process.platform === 'win32')('folder sizes on Windows', () => {
  it('measures a real folder with robocopy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pzm-size-'))
    mkdirSync(join(dir, 'map', 'deep'), { recursive: true })
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(1000))
    writeFileSync(join(dir, 'map', 'deep', 'b.bin'), Buffer.alloc(2345))
    let out = ''
    try { out = execFileSync('robocopy', folderSizeArgs(dir)).toString() } catch (e) {
      // robocopy exits with 1 when it would have copied files, that's success
      out = String((e as { stdout?: Buffer }).stdout || '')
    }
    expect(parseFolderSize(out)).toBe(3345)
  }, 30000)
})
