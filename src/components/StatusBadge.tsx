import type { ServerStatus } from '../store/useAppStore'

interface StatusBadgeProps {
  status: ServerStatus
  showLabel?: boolean
}

export default function StatusBadge({ status, showLabel = true }: StatusBadgeProps) {
  const config = {
    running: { dot: 'bg-pz-green pulse-green', text: 'text-pz-green', label: 'Running' },
    starting: { dot: 'bg-pz-yellow pulse-green', text: 'text-pz-yellow', label: 'Starting...' },
    stopping: { dot: 'bg-pz-red pulse-green', text: 'text-pz-red', label: 'Stopping...' },
    stopped: { dot: 'bg-pz-muted', text: 'text-pz-muted', label: 'Stopped' },
  }

  const c = config[status]

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      {showLabel && c.label}
    </span>
  )
}
