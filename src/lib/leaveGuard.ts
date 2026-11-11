import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'

// While a page has unsaved changes, the mouse back/forward buttons (and alt+left/right) ask
// first instead of throwing the changes away. ask() opens the page's own "leave without
// saving?" dialog. From that dialog, leave() carries on with the move that was held up
// (false if nothing was, e.g. the page's own Back button opened it) and stay() drops it.
export function useLeaveGuard(dirty: boolean, ask: () => void) {
  const setNavGuard = useAppStore(s => s.setNavGuard)
  const pending = useRef<(() => void) | null>(null)
  const askRef = useRef(ask)
  askRef.current = ask

  useEffect(() => {
    if (!dirty) {
      pending.current = null
      return
    }
    setNavGuard(proceed => {
      pending.current = proceed
      askRef.current()
    })
    return () => setNavGuard(null)
  }, [dirty])

  const leave = () => {
    const go = pending.current
    pending.current = null
    if (!go) return false
    go()
    return true
  }
  const stay = () => { pending.current = null }
  return { leave, stay }
}

// While held, the mouse back/forward buttons (and alt+left/right) do nothing: for something on
// the page that can't be left behind, like a rollback that's still going or its result screen
export function useNavHold(held: boolean) {
  const holdNav = useAppStore(s => s.holdNav)
  useEffect(() => (held ? holdNav() : undefined), [held])
}

// What's busy for one server: a job on its own world, and one on its game server install
export function useBusyFor(profile: { id: string; serverInstallPath: string }) {
  const busy = useAppStore(s => s.busy)
  const same = (a?: string) => !!a && a.replace(/[\\/]+$/, '').toLowerCase() === profile.serverInstallPath.replace(/[\\/]+$/, '').toLowerCase()
  const running = busy.jobs.filter(j => !j.done)
  return {
    // why it can't start now, if it can't
    blocked: busy.blocked[profile.id] as string | undefined,
    own: running.filter(j => j.profileId === profile.id).pop(),
    install: running.filter(j => same(j.installDir)).pop(),
    // a rollback of this server that finished and hasn't been shown yet
    finishedRollback: busy.jobs.find(j => j.done && j.kind === 'rollback' && j.profileId === profile.id),
  }
}
