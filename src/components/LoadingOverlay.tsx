import { useAppStore } from '../store/useAppStore'
import { Loader2 } from 'lucide-react'

export default function LoadingOverlay() {
  const { isLoading, loadingMessage } = useAppStore()

  if (!isLoading) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-pz-card border border-pz-border rounded-xl p-8 flex flex-col items-center gap-4 max-w-sm w-full mx-4">
        <Loader2 size={40} className="text-pz-green animate-spin" />
        <div className="text-center">
          <p className="text-pz-text font-medium">{loadingMessage || 'Loading...'}</p>
        </div>
      </div>
    </div>
  )
}
