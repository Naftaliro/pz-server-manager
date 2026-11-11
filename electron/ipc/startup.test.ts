import { describe, it, expect } from 'vitest'
import { secondLaunch, parseRunKey, commandExe, runKeyPlan, startupProblem, runCommand, RUN_VALUE } from './startup'

const REG = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
    OneDrive    REG_SZ    "C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background
    electron.app.Knox Launcher    REG_SZ    "C:\\Users\\Me\\AppData\\Local\\Programs\\pz-server-manager\\PZ Server Manager.exe" --started-with-windows
`
const NEW_EXE = 'C:\\Users\\Me\\AppData\\Local\\Programs\\pz-server-manager\\Knox Launcher.exe'

describe('the Run key', () => {
  it('is called Knox Launcher and starts the exe with the startup flag', () => {
    expect(RUN_VALUE).toBe('Knox Launcher')
    expect(runCommand(NEW_EXE)).toBe(`"${NEW_EXE}" --started-with-windows`)
  })

  it('reads reg query output', () => {
    expect(parseRunKey(REG)).toEqual([
      { name: 'OneDrive', command: '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background' },
      { name: 'electron.app.Knox Launcher', command: '"C:\\Users\\Me\\AppData\\Local\\Programs\\pz-server-manager\\PZ Server Manager.exe" --started-with-windows' },
    ])
    expect(commandExe('"C:\\A B\\x.exe" --y')).toBe('C:\\A B\\x.exe')
    expect(commandExe('C:\\x.exe /y')).toBe('C:\\x.exe')
  })

  it('moves the value 1.6.0 wrote to the new name, also after the exe got renamed', () => {
    const plan = runKeyPlan(parseRunKey(REG), NEW_EXE, () => false)
    expect(plan).toEqual({ on: true, migrate: true, remove: ['electron.app.Knox Launcher'] })
  })

  it("leaves another copy's value alone while that copy is still there", () => {
    const plan = runKeyPlan(parseRunKey(REG), 'D:\\Portable\\Knox Launcher.exe', () => true)
    expect(plan).toEqual({ on: false, migrate: false, remove: [] })
  })

  it('is on once the new value points at this exe', () => {
    const values = [{ name: 'Knox Launcher', command: `"${NEW_EXE}" --started-with-windows` }]
    expect(runKeyPlan(values, NEW_EXE.toLowerCase(), () => true)).toEqual({ on: true, migrate: false, remove: [] })
  })
})

describe('startupProblem', () => {
  const temp = 'C:\\Users\\Me\\AppData\\Local\\Temp'
  it('turns down a copy opened straight from the zip (a temp folder)', () => {
    expect(startupProblem(`${temp}\\Temp1_Knox-Launcher-1.6.0-win.zip\\Knox Launcher.exe`, [temp])).toMatch(/temporary folder/)
  })
  it('lets an unzipped portable copy and the installed one register', () => {
    expect(startupProblem('D:\\Games\\Knox Launcher\\Knox Launcher.exe', [temp])).toBeNull()
    expect(startupProblem(NEW_EXE, [temp])).toBeNull()
  })
})

describe('secondLaunch', () => {
  it('brings the open window to the front for a normal second launch', () => {
    expect(secondLaunch(['C:\\Apps\\Knox Launcher.exe'])).toBe('show')
  })
  it('stays out of the way when Windows starts it at login and it is already open', () => {
    expect(secondLaunch(['C:\\Apps\\Knox Launcher.exe', '--started-with-windows'])).toBe('ignore')
  })
})
