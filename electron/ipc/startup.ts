// Starting with Windows, and a second launch of the app while it's already open.
// No Electron in here, so the tests can check it.

// what Windows passes when it starts the app at login
export const STARTUP_ARG = '--started-with-windows'

// What a second launch wants from the copy that's already open. Windows starting it at login
// while it's already open (it was started by hand first) shouldn't pop it up
export function secondLaunch(argv: string[]): 'show' | 'ignore' {
  return argv.includes(STARTUP_ARG) ? 'ignore' : 'show'
}
