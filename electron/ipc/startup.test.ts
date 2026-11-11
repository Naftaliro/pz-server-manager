import { describe, it, expect } from 'vitest'
import { secondLaunch } from './startup'

describe('secondLaunch', () => {
  it('brings the open window to the front for a normal second launch', () => {
    expect(secondLaunch(['C:\\Apps\\Knox Launcher.exe'])).toBe('show')
  })
  it('stays out of the way when Windows starts it at login and it is already open', () => {
    expect(secondLaunch(['C:\\Apps\\Knox Launcher.exe', '--started-with-windows'])).toBe('ignore')
  })
})
