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
