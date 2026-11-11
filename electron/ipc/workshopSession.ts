// The mod browser's session (the Steam Workshop in a <webview>). Browsing mods needs nothing
// from the PC: no camera, microphone, location, notifications, clipboard, USB or anything else
// a page can ask for, and no downloads either (mods come through SteamCMD). So a page in
// there gets told no to all of it, without asking the user.

type LockableSession = Pick<Electron.Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler' | 'setDevicePermissionHandler' | 'on'>

export function lockDownSession(ses: LockableSession): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
  ses.on('will-download', (e) => e.preventDefault())
}
