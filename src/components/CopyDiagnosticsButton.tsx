import { useState } from 'react'
import { ClipboardCopy, Check, Loader } from 'lucide-react'

// Copies a scrubbed report (versions, settings, server status, log tail) to paste into a bug report
export default function CopyDiagnosticsButton({ className = 'btn-outline text-xs' }: { className?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle')

  const copy = async () => {
    setState('busy')
    try {
      await window.electronAPI.diagnostics.copy()
      setState('copied')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 3000)
  }

  return (
    <button onClick={copy} disabled={state === 'busy'} className={className}>
      {state === 'busy' ? <Loader size={12} className="animate-spin" /> : state === 'copied' ? <Check size={12} /> : <ClipboardCopy size={12} />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : 'Copy diagnostics'}
    </button>
  )
}
