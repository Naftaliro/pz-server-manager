// The .bat files and cmd command lines the app hands to Windows. No Electron in here,
// so the tests can build them exactly like the app does and run the real thing.

import { win32 } from 'path'

// cmd reads a .bat in the console's old code page, not UTF-8, so a path like
// C:\Users\José came out garbled. 65001 is UTF-8, and it has to come before any path.
const UTF8 = 'chcp 65001 > nul'

// Text going into a .bat line, which cmd reads once: %% is the only way to get a
// literal %. None of these scripts turn on delayed expansion, so ! needs nothing.
export function batText(s: string): string {
  return s.replace(/%/g, '%%')
}

// A value that ends up inside "..." on a program's command line: backslashes right
// before the closing quote would escape it (C:\dir\ has to go in as "C:\dir\\")
export function quotedValue(s: string): string {
  return s.replace(/(\\+)$/, '$1$1')
}

// Our copy of StartServer64.bat, made fresh every start so Steam updates to the real one still apply:
//  - the stock bat only forwards %1 %2, so everything after -servername got dropped
//  - the admin password comes from a variable the launcher sets, read here in a single pass.
//    As an argument it went through `call`, which reads % a second time (50%off became 50off)
//  - the profile's memory replaces -Xms / -Xmx (stock B42 hardcodes 16g, which fails on smaller PCs)
//  - no PAUSE at the end, it left a "press any key" window behind after every stop
export function patchStartBat(original: string, memoryMb?: number): string {
  let patched = original
    .replace(/%1 %2(?: %3)?(?: %4)?(?: %5)?(?: %6)?/g, '%* -adminpassword "%PZM_ADMINPW%"')
    .replace(/^\s*PAUSE\s*$/gim, '')
  if (memoryMb && memoryMb >= 1024) {
    patched = patched
      .replace(/-Xms\d+[mMgG]?/g, `-Xms${memoryMb}m`)
      .replace(/-Xmx\d+[mMgG]?/g, `-Xmx${memoryMb}m`)
  }
  return patched
}

export interface LauncherOptions {
  // letters, digits, _ and - only (getServerName)
  serverName: string
  serverDir: string
  // file name of the start bat inside serverDir
  startBat: string
  // can't contain " (checked before starting)
  adminPassword: string
  // -cachedir, only when the data folder isn't the default one
  cacheDir?: string
}

// What the server window runs
export function launcherScript(o: LauncherOptions): string {
  return [
    '@echo off',
    UTF8,
    `title PZ Server - ${o.serverName}`,
    `cd /d "${batText(o.serverDir)}"`,
    'echo ================================================',
    `echo  Project Zomboid Server: ${o.serverName}`,
    'echo  Managed by Knox Launcher - use the app to stop it',
    'echo ================================================',
    `set "PZM_ADMINPW=${batText(quotedValue(o.adminPassword))}"`,
    ...(o.cacheDir ? [`set "PZM_CACHEDIR=${batText(quotedValue(o.cacheDir))}"`] : []),
    // .\ on purpose: with NoDefaultCurrentDirectoryInExePath set (some dev tools set it)
    // cmd won't look in the current folder and says the bat "is not recognized".
    // %%PZM_CACHEDIR%% is still a variable after the first read, so `call` swaps in the
    // folder on its second one and nothing in the folder name gets read twice
    `call ".\\${o.startBat}" -servername "${o.serverName}"${o.cacheDir ? ' -cachedir="%%PZM_CACHEDIR%%"' : ''}`,
    // close the window after a clean quit (in-game /quit, typed in the window),
    // but leave it open after a crash so the error can still be read
    'if not errorlevel 1 exit',
  ].join('\r\n')
}

export interface UpdateScriptOptions {
  zipPath: string
  extractDir: string
  // the running app's exe, which gets replaced and started again
  appExe: string
}

// What runs after the app quits to put a downloaded update in place
export function updateScript(o: UpdateScriptOptions): string {
  const exe = batText(win32.basename(o.appExe))
  const appDir = batText(win32.dirname(o.appExe))
  const extractDir = batText(o.extractDir)
  // single-quoted for powershell inside a .bat line
  const ps = (p: string) => batText(p.replace(/'/g, "''"))
  return [
    '@echo off',
    UTF8,
    'title Knox Launcher - Updating...',
    'echo ================================================',
    'echo  Knox Launcher Auto-Updater',
    'echo ================================================',
    'echo.',
    'echo Waiting for the app to fully close...',
    // files stay locked until every app process is gone, so wait for that (up to ~30s)
    'set /a TRIES=0',
    ':waitloop',
    `tasklist /FI "IMAGENAME eq ${exe}" /NH | find /I "${exe}" > nul`,
    'if errorlevel 1 goto closed',
    'set /a TRIES+=1',
    'if %TRIES% geq 30 goto closed',
    'timeout /t 1 /nobreak > nul',
    'goto waitloop',
    ':closed',
    '',
    'echo Extracting update package...',
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '${ps(o.zipPath)}' -DestinationPath '${ps(o.extractDir)}' -Force"`,
    'if errorlevel 1 goto failed',
    '',
    // the release zip is flat (exe at the root next to locales\ and resources\),
    // so look for the exe instead of grabbing the first subfolder
    'set "SRC="',
    `if exist "${extractDir}\\${exe}" set "SRC=${extractDir}"`,
    `if not defined SRC for /d %%i in ("${extractDir}\\*") do if not defined SRC if exist "%%i\\${exe}" set "SRC=%%i"`,
    'if not defined SRC goto failed',
    '',
    `echo Copying new files to "${appDir}"`,
    `robocopy "%SRC%" "${appDir}" /E /IS /IT /IM /NP /NJH /NJS > nul 2> nul`,
    // robocopy: 0-7 is success, 8 and up is an error
    'if not errorlevel 8 goto copied',
    'echo Robocopy reported errors, trying xcopy...',
    `xcopy /E /Y /I "%SRC%\\*" "${appDir}\\" > nul`,
    'if errorlevel 1 goto failed',
    ':copied',
    '',
    'echo.',
    'echo Update complete! Relaunching Knox Launcher...',
    'timeout /t 2 /nobreak > nul',
    `start "" "${batText(o.appExe)}"`,
    ':: clean up this batch file',
    'del "%~f0"',
    'exit /b 0',
    '',
    ':failed',
    'echo.',
    "echo ERROR: The update didn't finish. Get the new version from",
    'echo https://github.com/Naftaliro/pz-server-manager/releases/latest',
    'pause',
    'exit /b 1',
  ].join('\r\n')
}

// For spawn('cmd.exe', [args], { windowsVerbatimArguments: true, env: { ...process.env, ...env } }).
// cmd drops the quotes around a path with & ( ) ^ or @ in it and then splits it there
// (C:\Program Files (x86)\... is the usual one). Paths that only show up as a %variable%
// inside quotes get expanded by the outer cmd after that check, so they come through whole.
export interface CmdLaunch {
  args: string
  env: Record<string, string>
}

// The server's own console window, minimized. `start` names the window, which is what
// the QuickEdit setting is keyed on, and /k keeps it open if the server crashes.
export function serverWindowCommand(title: string, serverDir: string, launcherPath: string): CmdLaunch {
  return {
    args: `/d /c start "${title}" /min /D "%PZM_DIR%" cmd.exe /d /k call "%PZM_LAUNCHER%"`,
    env: { PZM_DIR: serverDir, PZM_LAUNCHER: launcherPath },
  }
}

// The updater's window. Through `start` so it gets a console of its own and outlives the app.
export function updaterWindowCommand(scriptPath: string): CmdLaunch {
  return {
    args: '/d /c start "Knox Launcher Updater" cmd.exe /d /c call "%PZM_UPDATER%"',
    env: { PZM_UPDATER: scriptPath },
  }
}

// Types a command into the server window, for when RCON isn't answering. Goes to
// powershell as its own argument (no cmd in between), so quotes in the command are fine.
export function sendKeysScript(windowTitle: string, text: string): string {
  const keys = text.replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, '{$&}')
  const title = windowTitle.replace(/'/g, "''")
  // ESC first: if the window is stuck in "Select" mode the first key only ends the
  // selection, which would turn "quit" into "uit"
  return `$wshell = New-Object -ComObject wscript.shell; $null = $wshell.AppActivate('${title}'); Start-Sleep -Milliseconds 200; $wshell.SendKeys('{ESC}'); Start-Sleep -Milliseconds 100; $wshell.SendKeys('${keys}{ENTER}')`
}

// ── Windows Firewall ─────────────────────────────────────────────────────────

export const FIREWALL_RULE = 'Knox Launcher - Project Zomboid server'
// what older versions added: every port, TCP and UDP, which also opened RCON to the network
export const OLD_FIREWALL_RULE = 'PZ Server Manager - Project Zomboid server'

export interface FirewallEntry {
  // the server install's java.exe, the rule only covers that program
  program: string
  // DefaultPort and UDPPort of every server using this install
  ports: number[]
}

function portList(ports: number[]): string {
  return [...new Set(ports)].filter(p => Number.isInteger(p) && p >= 1 && p <= 65535).sort((a, b) => a - b).join(',')
}

// netsh exits with an error when there's no rule to delete, that's fine here
const deleteOurRules = [OLD_FIREWALL_RULE, FIREWALL_RULE].map(name => `netsh advfirewall firewall delete rule name="${name}" > nul`)

// The elevated .cmd for "Allow the server": drop our rules (the old allow-everything one too),
// then one rule per server install that only opens the UDP ports players connect to.
// B42 has no separate Steam ports (only DefaultPort, UDPPort and RCONPort exist), and RCON
// stays closed. profile=any on purpose: lots of home networks are marked Public in Windows
export function firewallScript(entries: FirewallEntry[]): string {
  return [
    '@echo off',
    UTF8,
    ...deleteOurRules,
    ...entries.filter(e => portList(e.ports)).map(e =>
      `netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow program="${batText(e.program)}" protocol=UDP localport=${portList(e.ports)} enable=yes profile=any`),
  ].join('\r\n')
}

export function firewallRemoveScript(): string {
  return ['@echo off', ...deleteOurRules].join('\r\n')
}

// Reading the rules needs no admin. Get-NetFirewallRule's values (True, Inbound, Allow, UDP)
// are the same in every Windows language, netsh's text output isn't
export function firewallQueryScript(): string {
  const names = [FIREWALL_RULE, OLD_FIREWALL_RULE].map(n => `'${n.replace(/'/g, "''")}'`).join(',')
  return `$r = @(Get-NetFirewallRule -DisplayName ${names} -ErrorAction SilentlyContinue | ForEach-Object { $p = $_ | Get-NetFirewallPortFilter; $a = $_ | Get-NetFirewallApplicationFilter; [pscustomobject]@{ name = $_.DisplayName; enabled = [string]$_.Enabled; direction = [string]$_.Direction; action = [string]$_.Action; protocol = [string]$p.Protocol; ports = @($p.LocalPort | ForEach-Object { [string]$_ }); program = [string]$a.Program } }); ConvertTo-Json -InputObject $r -Compress -Depth 3`
}

export interface FirewallRuleInfo {
  name: string
  enabled: string
  direction: string
  action: string
  protocol: string
  // "16261", "16262", or "Any" for the old rule
  ports: string[]
  program: string
}

export interface FirewallState {
  // every server's game ports are open, and nothing else from us is
  upToDate: boolean
  // the old allow-everything rule is still there
  oldRule: boolean
  // any rule of ours exists (what "Remove" would take away)
  anyRule: boolean
}

export function firewallState(needed: FirewallEntry[], rules: FirewallRuleInfo[]): FirewallState {
  const ours = rules.filter(r => r.name === FIREWALL_RULE)
  const oldRule = rules.some(r => r.name === OLD_FIREWALL_RULE)
  const samePath = (a: string, b: string) => win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase()
  const covered = needed.length > 0 && needed.every(e => e.ports.every(port => ours.some(r =>
    r.enabled === 'True' && r.direction === 'Inbound' && r.action === 'Allow' && r.protocol === 'UDP'
    && samePath(r.program, e.program) && r.ports.includes(String(port)))))
  return { upToDate: covered && !oldRule, oldRule, anyRule: ours.length > 0 || oldRule }
}

// ── Installer updates ────────────────────────────────────────────────────────

// The installed (NSIS) copy has electron-builder's uninstaller next to the exe, named after
// the exe ("Uninstall ${productFilename}.exe", and productFilename comes from executableName,
// so here "Uninstall PZ Server Manager.exe"). The portable zip doesn't have one
export function uninstallerFor(appExe: string): string {
  const name = win32.basename(appExe).replace(/\.exe$/i, '')
  return win32.join(win32.dirname(appExe), `Uninstall ${name}.exe`)
}

// electron-builder's NSIS switches: silent, an update (waits for the app to close and skips
// its pages), and start the app again when it's done. It installs over the same folder
export const INSTALLER_UPDATE_ARGS = ['/S', '--updated', '--force-run']

// The first bytes of a download: a Windows program (MZ and PE headers) that is an NSIS
// installer. Its "NullsoftInst" header comes right after the small setup program, about
// 100 KB in, so the first 1 MB is plenty
export function isNsisInstaller(head: Uint8Array): boolean {
  const buf = Buffer.from(head.buffer, head.byteOffset, head.byteLength)
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) return false
  const pe = buf.readUInt32LE(0x3c)
  if (pe + 4 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') return false
  return buf.indexOf('NullsoftInst', 0, 'latin1') !== -1
}

// The name on the certificate releases are signed with (Microsoft Artifact Signing, see
// CODE_SIGNING_POLICY.md). Only the name is checked: the certificate also has the city and
// state, and those change if the publisher moves
export const RELEASE_SIGNER = 'Mitchell Berg'

// Windows' own check of a file's signature, no admin needed. Status is Valid, NotSigned,
// HashMismatch, NotTrusted and so on, the same in every Windows language. Signatures stay
// Valid after the 3-day certificate runs out because the build timestamps them.
// The module comes from Windows PowerShell's own folder: started from PowerShell 7 it inherits
// a module path where 7's copy comes first and won't load. Any error stops the script, so a
// check that couldn't run never looks like an unsigned file
export function signatureQueryScript(file: string): string {
  return `$ErrorActionPreference = 'Stop'; Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security'); $s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; $n = ''; if ($s.SignerCertificate) { $n = $s.SignerCertificate.GetNameInfo('SimpleName', $false) }; ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ status = [string]$s.Status; signer = [string]$n })`
}

export interface SignatureInfo {
  status: string
  // the certificate's name (CN), '' when the file isn't signed
  signer: string
}

export function signedByUs(sig: SignatureInfo): boolean {
  return sig.status === 'Valid' && sig.signer === RELEASE_SIGNER
}

// ── Folder sizes ─────────────────────────────────────────────────────────────

// A world save is tens of thousands of small chunk files (VAN: 87,719) and every backup is
// another copy. Statting them one by one took 40 s and froze the app. robocopy in list mode
// (/L, copies nothing) gets every size from the folder listing itself: 1.6 s for that world,
// in its own process. /BYTES = plain numbers, /NFL /NDL /NJH = only the totals at the end
export function folderSizeArgs(dir: string): string[] {
  return [dir, 'NUL', '/L', '/S', '/NFL', '/NDL', '/NJH', '/NP', '/BYTES', '/R:0', '/W:0']
}

// The totals table is Dirs, Files, Bytes, Times. Its labels are in the PC's language
// ("Octets" in French) but the rows always come in that order, so take the third row
// that's all numbers. null if it isn't there (robocopy failed)
export function parseFolderSize(output: string): number | null {
  const rows = output.split(/\r?\n/)
    .map(l => l.match(/:\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s*$/))
    .filter((m): m is RegExpMatchArray => !!m)
  return rows.length >= 3 ? Number(rows[2][1]) : null
}
