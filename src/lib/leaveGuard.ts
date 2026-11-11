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
