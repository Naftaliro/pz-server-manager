// Reading a starting server's log for the moment it gives up. No Electron or fs in here, so
// the tests feed it real log lines.
//
// When a mod breaks the world loading, B42 logs the real error first, carries on for a bit,
// then gives up:
//   ERROR: General ...> ScriptManager.PostWorldDictionaryInit> Exception thrown
//   	java.lang.Exception: Fluid not found: Alcohol. line: fluid 0.1 [Alcohol] at InputScript...
//   ...
//   ERROR: General ...> GameServer.main> Exception thrown
//   	zombie.world.WorldDictionaryException: World loading could not proceed, there are script load errors. (Actual error may be printed earlier in log) ...
//   LOG  : General ...> Server Terminated.
// and java keeps running with nothing loaded. "Exception thrown" on its own means nothing:
// a big mod list logs hundreds of harmless ones (missing AnimSets folders and so on).

export interface LoggedError {
  // the class and message: "java.lang.Exception: Fluid not found: Alcohol. line: fluid 0.1 [Alcohol]"
  text: string
  // what logged it: "ScriptManager.PostWorldDictionaryInit", "GameServer.main"
  from: string
  // a (MOD:<name>) seen in the error or its stack trace
  mod?: string
  // a workshop item named in the error (a file path inside it)
  workshopId?: string
}

export interface StartFailure {
  // the error that actually stopped it (the one the game says "may be printed earlier")
  cause: LoggedError | null
  // the line that said it gave up
  fatalLine: string
}

const HEADER = /^(?:ERROR|WARN|LOG)\s*:\s*\S+[^>]*>\s*(?:at\s+)?([^>]+?)\s*>\s*Exception thrown/i
const EXCEPTION = /^\s*((?:[a-z_$][\w$]*\.)+(?:[A-Z][\w$]*?)?(?:Exception|Error)):\s*(.*)$/
const MOD_TAG = /\(MOD:([^)]+)\)/
const WORKSHOP_PATH = /[\\/]content[\\/]108600[\\/](\d+)[\\/]/
// noise from mods that don't ship every folder, never what stops a server
const HARMLESS = /NoSuchFileException/
const TERMINATED = /\bServer Terminated\.?\s*$/

// The game logs "Exception: <message> at Class.method(File.java:123)." on one line
function cleanMessage(msg: string): string {
  return msg.replace(/\s+at\s+[\w$.<>]+\([^)]*\)\.?\s*$/, '').trim()
}

export class StartWatch {
  private errors: LoggedError[] = []
  // the "X> Exception thrown" line waiting for its exception on the next line
  private header: string | null = null
  // the error being followed through its stack trace
  private current: LoggedError | null = null
  private fatalFrom: LoggedError | null = null
  failed: StartFailure | null = null

  // Feed every log line in order. Returns the failure once, on the line it's known
  feed(line: string): StartFailure | null {
    if (this.failed) return null
    const header = line.match(HEADER)
    if (header) {
      this.header = header[1]
      this.current = null
      return null
    }
    const ex = line.match(EXCEPTION)
    if (ex && this.header !== null) {
      const err: LoggedError = { text: `${ex[1]}: ${cleanMessage(ex[2])}`, from: this.header }
      this.header = null
      // Lua((MOD:They Knew [B42])).TheyKnew_BodyLocations.lua> Exception thrown
      this.tag(err, err.from)
      this.tag(err, line)
      if (HARMLESS.test(ex[1])) return null
      this.current = err
      if (/^GameServer\.main/.test(err.from) || /WorldDictionaryException/.test(ex[1])) {
        this.fatalFrom = err
        return this.fail(line)
      }
      this.errors.push(err)
      if (this.errors.length > 20) this.errors.shift()
      return null
    }
    // stack trace lines start with a tab
    if (this.current && /^\s/.test(line)) {
      this.tag(this.current, line)
      return null
    }
    this.current = null
    if (!/^\s/.test(line)) this.header = null
    if (TERMINATED.test(line)) return this.fail(line)
    return null
  }

  // the newest error worth mentioning (for a server that closed by itself)
  lastError(): LoggedError | null {
    return this.errors[this.errors.length - 1] || null
  }

  private tag(err: LoggedError, line: string) {
    err.mod ||= line.match(MOD_TAG)?.[1]?.trim()
    err.workshopId ||= line.match(WORKSHOP_PATH)?.[1]
  }

  private fail(line: string): StartFailure {
    const fatal = this.fatalFrom
    // "World loading could not proceed, there are script load errors. (Actual error may be
    // printed earlier in log)": the cause is the last script error before it
    const pointsBack = !fatal || /earlier in log|script load errors/i.test(fatal.text)
    const scriptError = [...this.errors].reverse().find(e => /Script/i.test(e.from))
    const cause = pointsBack ? (scriptError || this.errors[this.errors.length - 1] || fatal) : fatal
    this.failed = { cause: cause || null, fatalLine: fatal ? fatal.text : line.trim() }
    return this.failed
  }
}

// The script line the game quotes in a script error ("... line: fluid 0.1 [Alcohol]"), to
// find which mod's files have it when the error doesn't say
export function quotedScriptLine(error: string): string | null {
  const m = error.match(/\bline:\s*(.+?)\s*$/i)
  return m && m[1].length >= 4 ? m[1] : null
}

// What the Overview shows for a failed start, in plain words
export function startFailureHint(cause: LoggedError | null, modName?: string): string {
  const what = cause ? cause.text.replace(/^(?:java\.lang\.)?Exception:\s*/, '') : ''
  if (modName) {
    return `The mod ${modName} stopped the world loading${what ? `: ${what}` : '.'}${/[.!]$/.test(what) || !what ? '' : '.'} Open the Mods tab and switch that mod off, then start the server again.`
  }
  return `The server stopped while loading the world${what ? `: ${what}` : '.'}${/[.!]$/.test(what) || !what ? '' : '.'} This is usually a mod that doesn't work with this game version. The console log has the details.`
}

// "required mod "gnomeBars" not found": the game says this both for a mod another mod needs
// that isn't in the list, and for a mod in the list that has no files for this build
export function requiredModHint(line: string, enabled: string[]): string | null {
  const id = line.match(/required mod\s+"?([^"\s]+)"?\s+not found/i)?.[1]
  if (!id) return null
  if (enabled.some(e => e.toLowerCase() === id.toLowerCase())) {
    return `The server couldn't load "${id}" even though it's in your list. Usually it has no files for this game build, or it hasn't finished downloading. Check it on the Mods tab.`
  }
  return `A mod needs "${id}", which isn't in your list. Add it on the Mods tab.`
}

// Lines worth showing as "what the server is doing" while it starts: not warnings, not stack traces
export function isProgressLine(line: string): boolean {
  return /^LOG\s*:/.test(line) && !/^\s/.test(line)
}
