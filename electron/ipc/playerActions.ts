// Kick / ban / admin from the players list: the RCON command for each, and what the game's
// answer means. RCON answers every command, a failed one too ("User ghost doesn't exist."),
// so the answer has to be read before saying it worked. No Electron in here, for the tests.

export type PlayerAction = 'kick' | 'ban' | 'unban' | 'admin' | 'unadmin'

// B42's access levels: banned, user, priority, observer, gm, moderator, admin. B41 has no
// "user", a normal player is "none" there ("" or "user" is turned away on B42)
export function playerCommand(action: PlayerAction, name: string, build: 'b41' | 'b42'): string | null {
  const safe = name.replace(/"/g, '')
  switch (action) {
    case 'kick': return `kickuser "${safe}"`
    case 'ban': return `banuser "${safe}"`
    case 'unban': return `unbanuser "${safe}"`
    case 'admin': return `setaccesslevel "${safe}" admin`
    case 'unadmin': return `setaccesslevel "${safe}" ${build === 'b41' ? 'none' : 'user'}`
    default: return null
  }
}

// The game's ways of saying no
const REFUSED = [
  /doesn'?t exist/i,
  /does not exist/i,
  /\bnot found\b/i,
  /\bunknown\b/i,
  /\bno (?:such )?(?:user|player)\b/i,
  /\bis not banned\b|\bisn'?t banned\b|\bnot banned\b/i,
  /\balready (?:banned|has)\b/i,
  /\bcan'?t\b|\bcannot\b/i,
  /\bdo(?:es)? not have\b|\bdon'?t have\b|\bsufficient rights\b/i,
  /\berror\b|\bfailed\b|\bexception\b/i,
  /^usage\b|\bwrong (?:number|argument)/i,
]

export function actionResult(action: PlayerAction, name: string, reply: string): { success: boolean; message: string } {
  const text = reply.trim()
  if (REFUSED.some(r => r.test(text))) return { success: false, message: text || `The server said no to that.` }
  const done = {
    kick: `Kicked ${name}.`,
    ban: `Banned ${name}.`,
    unban: `${name} can join again.`,
    admin: `${name} is an admin now.`,
    unadmin: `${name} isn't an admin anymore.`,
  }[action]
  return { success: true, message: done }
}

// setaccesslevel and banuser make a new account for a name the server has never seen, so
// a typo would leave a stray entry behind. Only names it knows (or who are online) go through
export function knownName(name: string, known: string[], online: string[]): boolean {
  const n = name.trim().toLowerCase()
  return [...known, ...online].some(k => k.toLowerCase() === n)
}
