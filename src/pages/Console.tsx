import { useState, useEffect, useRef } from 'react'
import {
  ArrowLeft, Play, Square, RotateCcw, Send, Trash2,
  ChevronDown, Terminal, Copy, CheckCircle
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import StatusBadge from '../components/StatusBadge'
import type { ServerStatus } from '../store/useAppStore'

const QUICK_COMMANDS = [
  { label: 'Players', cmd: 'players' },
  { label: 'Save', cmd: 'save' },
  { label: 'Quit', cmd: 'quit' },
  { label: 'Help', cmd: 'help' },
  { label: 'Kick All', cmd: 'kickuser *' },
  { label: 'Chopper', cmd: 'sendpulse' },
]

export default function Console() {
  const {
    activeProfileId, setActiveView, profiles,
    serverStatuses, consoleLogs, appendConsoleLog, clearConsoleLogs,
  } = useAppStore()

  const [command, setCommand] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const [actionLoading, setActionLoading] = useState('')
  const consoleRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)

  const profile = profiles.find(p => p.id === activeProfileId)
  const status = (serverStatuses[activeProfileId || ''] || 'stopped') as ServerStatus
  const logs = consoleLogs[activeProfileId || ''] || []

  useEffect(() => {
    if (!activeProfileId) return

    const unsub = window.electronAPI.server.onConsoleOutput(activeProfileId, (line) => {
      appendConsoleLog(activeProfileId, line)
    })

    return unsub
  }, [activeProfileId])

  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleStart = async () => {
    if (!activeProfileId) return
    setActionLoading('starting')
    const result = await window.electronAPI.server.start(activeProfileId)
    if (!result.success) {
      appendConsoleLog(activeProfileId, `[ERROR] Failed to start: ${result.message}`)
    }
    setActionLoading('')
  }

  const handleStop = async () => {
    if (!activeProfileId) return
    setActionLoading('stopping')
    const result = await window.electronAPI.server.stop(activeProfileId)
    if (!result.success) {
      appendConsoleLog(activeProfileId, `[ERROR] Failed to stop: ${result.message}`)
    }
    setActionLoading('')
  }

  const handleRestart = async () => {
    if (!activeProfileId) return
    setActionLoading('restarting')
    await window.electronAPI.server.stop(activeProfileId)
    await new Promise(r => setTimeout(r, 3000))
    await window.electronAPI.server.start(activeProfileId)
    setActionLoading('')
  }

  const sendCommand = async (cmd: string) => {
    if (!activeProfileId || !cmd.trim()) return
    const result = await window.electronAPI.server.sendCommand(activeProfileId, cmd)
    if (result.success) {
      appendConsoleLog(activeProfileId, `> ${cmd}`)
      setCmdHistory(prev => [cmd, ...prev.slice(0, 49)])
      setHistoryIdx(-1)
    } else {
      appendConsoleLog(activeProfileId, `[ERROR] Server not running`)
    }
  }

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!command.trim()) return
    sendCommand(command.trim())
    setCommand('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIdx = Math.min(historyIdx + 1, cmdHistory.length - 1)
      setHistoryIdx(newIdx)
      setCommand(cmdHistory[newIdx] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIdx = Math.max(historyIdx - 1, -1)
      setHistoryIdx(newIdx)
      setCommand(newIdx === -1 ? '' : cmdHistory[newIdx])
    }
  }

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const getLineColor = (line: string) => {
    if (line.startsWith('> ')) return 'text-pz-blue'
    if (line.includes('[ERROR]') || line.includes('ERROR') || line.includes('Exception')) return 'text-pz-red'
    if (line.includes('WARN') || line.includes('Warning')) return 'text-pz-yellow'
    if (line.includes('SERVER STARTED') || line.includes('players connected') || line.includes('LuaManager')) return 'text-pz-green'
    if (line.startsWith('[STDERR]')) return 'text-pz-red/70'
    if (line.includes('=== ') || line.includes('Installation')) return 'text-pz-yellow'
    return 'text-pz-muted'
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <button onClick={() => setActiveView('dashboard')} className="btn-ghost p-1.5">
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-3 flex-1">
          <Terminal size={16} className="text-pz-green" />
          <div>
            <h1 className="text-lg font-semibold text-pz-text">{profile?.name}</h1>
            <StatusBadge status={status} />
          </div>
        </div>

        {/* Server controls */}
        <div className="flex items-center gap-2">
          {status === 'stopped' && (
            <button
              onClick={handleStart}
              disabled={!!actionLoading}
              className="btn-primary"
            >
              <Play size={14} />
              {actionLoading === 'starting' ? 'Starting...' : 'Start'}
            </button>
          )}
          {(status === 'running' || status === 'starting') && (
            <>
              <button
                onClick={handleRestart}
                disabled={!!actionLoading}
                className="btn-outline"
              >
                <RotateCcw size={14} />
                {actionLoading === 'restarting' ? 'Restarting...' : 'Restart'}
              </button>
              <button
                onClick={handleStop}
                disabled={!!actionLoading}
                className="btn-danger"
              >
                <Square size={14} />
                {actionLoading === 'stopping' ? 'Stopping...' : 'Stop'}
              </button>
            </>
          )}
          {status === 'stopping' && (
            <span className="text-sm text-pz-red">Stopping...</span>
          )}
        </div>
      </div>

      {/* Quick commands */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-pz-border bg-pz-darker flex-shrink-0 overflow-x-auto">
        <span className="text-xs text-pz-muted flex-shrink-0">Quick:</span>
        {QUICK_COMMANDS.map(qc => (
          <button
            key={qc.cmd}
            onClick={() => sendCommand(qc.cmd)}
            disabled={status !== 'running'}
            className="btn-ghost text-xs py-1 px-2 flex-shrink-0"
          >
            {qc.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`btn-ghost text-xs py-1 px-2 flex-shrink-0 ${autoScroll ? 'text-pz-green' : 'text-pz-muted'}`}
          title="Toggle auto-scroll"
        >
          <ChevronDown size={12} />
          Auto-scroll
        </button>
        <button onClick={copyLogs} className="btn-ghost text-xs py-1 px-2 flex-shrink-0" title="Copy all logs">
          {copied ? <CheckCircle size={12} className="text-pz-green" /> : <Copy size={12} />}
        </button>
        <button
          onClick={() => activeProfileId && clearConsoleLogs(activeProfileId)}
          className="btn-ghost text-xs py-1 px-2 flex-shrink-0"
          title="Clear console"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Console output */}
      <div
        ref={consoleRef}
        className="flex-1 overflow-y-auto p-4 bg-pz-darker console-output"
        onScroll={(e) => {
          const el = e.currentTarget
          const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
          setAutoScroll(isAtBottom)
        }}
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Terminal size={28} className="text-pz-muted" />
            <p className="text-pz-muted text-sm">
              {status === 'stopped' ? 'Start the server to see output here.' : 'Waiting for server output...'}
            </p>
          </div>
        ) : (
          logs.map((line, i) => (
            <div key={i} className={`leading-relaxed ${getLineColor(line)}`}>
              {line || '\u00A0'}
            </div>
          ))
        )}
      </div>

      {/* Command input */}
      <div className="flex-shrink-0 border-t border-pz-border bg-pz-darker p-3">
        <form onSubmit={handleCommandSubmit} className="flex gap-2">
          <div className="flex items-center text-pz-green mr-1">
            <span className="font-mono text-sm">{'>'}</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            className="input flex-1 font-mono text-sm"
            placeholder={status === 'running' ? 'Enter server command... (↑↓ for history)' : 'Server is not running'}
            disabled={status !== 'running'}
          />
          <button
            type="submit"
            disabled={status !== 'running' || !command.trim()}
            className="btn-primary"
          >
            <Send size={14} />
          </button>
        </form>
        <p className="text-xs text-pz-muted mt-1 ml-5">
          Common commands: <code>players</code> · <code>save</code> · <code>quit</code> · <code>adduser &lt;name&gt; &lt;pass&gt;</code> · <code>banuser &lt;name&gt;</code>
        </p>
      </div>
    </div>
  )
}
