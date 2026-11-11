import { describe, it, expect } from 'vitest'
import { lockDownSession } from './workshopSession'

// security review F10: a Workshop page asking for anything
describe('the mod browser session', () => {
  const handlers: Record<string, (...args: any[]) => unknown> = {}
  lockDownSession({
    setPermissionRequestHandler: (fn: any) => { handlers.request = fn },
    setPermissionCheckHandler: (fn: any) => { handlers.check = fn },
    setDevicePermissionHandler: (fn: any) => { handlers.device = fn },
    on: ((name: string, fn: any) => { handlers[name] = fn }) as any,
  })

  it('says no to every permission a page asks for', () => {
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'openExternal', 'pointerLock', 'hid', 'serial', 'usb', 'unknown']) {
      let answer: boolean | undefined
      handlers.request({}, permission, (granted: boolean) => { answer = granted }, {})
      expect(answer, permission).toBe(false)
      expect(handlers.check({}, permission, 'https://steamcommunity.com', {}), permission).toBe(false)
    }
    expect(handlers.device({ deviceType: 'usb' })).toBe(false)
  })

  it('stops downloads', () => {
    let stopped = false
    handlers['will-download']({ preventDefault: () => { stopped = true } })
    expect(stopped).toBe(true)
  })
})
