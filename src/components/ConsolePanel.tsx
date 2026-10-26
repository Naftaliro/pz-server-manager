import { useState, useEffect, useRef } from 'react'
import { Send, Trash2, ChevronDown, Terminal, Copy, CheckCircle } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { ServerProfile } from '../store/useAppStore'

const QUICK_COMMANDS = [
  { label: 'Players', cmd: 'players' },
  { label: 'Save world', cmd: 'save' },
  { label: 'Help', cmd: 'help' },
  { label: 'Helicopter', cmd: 'chopper' },
  { label: 'Thunder', cmd: 'thunder' },
]

function lineColor(line: string): string {
  if (line.startsWith('> ')) return 'text-pz-blue'
  if (line.startsWith('[Knox]')) return 'text-pz-green'
  if (/\bERROR\b|Exception|\[ERR\]/.test(line)) return 'text-pz-red'
  if (/\bWARN/.test(line)) return 'text-pz-yellow'
  if (/SERVER STARTED/i.test(line)) return 'text-pz-teal'
  return 'text-pz-subtext'
}

export default function ConsolePanel({ profile }: { profile: ServerProfile }) {
  const { serverStatuses, consoleLogs, clearConsoleLogs } = useAppStore()
  const [command, setCommand] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const consoleRef = useRef<HTMLDivElement>(null)

  const status = serverStatuses[profile.id] || 'stopped'
  const logs = consoleLogs[profile.id] || []
  const canSend = status === 'running'

  useEffect(() => {
    if (autoScroll && consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [logs, autoScroll])

  const send = async (cmd: string) => {
    if (!cmd.trim()) return
    // the backend echoes the command and its output into the console
    await window.electronAPI.server.sendCommand(profile.id, cmd)
    setHistory(prev => [cmd, ...prev.filter(c => c !== cmd).slice(0, 49)])
    setHistoryIdx(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const i = Math.min(historyIdx + 1, history.length - 1)
      setHistoryIdx(i)
      setCommand(history[i] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const i = Math.max(historyIdx - 1, -1)
      setHistoryIdx(i)
      setCommand(i === -1 ? '' : history[i])
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-pz-border bg-pz-darker flex-shrink-0 overflow-x-auto">
        <span className="text-xs text-pz-muted flex-shrink-0">Quick:</span>
        {QUICK_COMMANDS.map(qc => (
          <button key={qc.cmd} onClick={() => send(qc.cmd)} disabled={!canSend} className="btn-ghost text-xs py-1 px-2 flex-shrink-0 disabled:opacity-40">
            {qc.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`btn-ghost text-xs py-1 px-2 flex-shrink-0 ${autoScroll ? 'text-pz-green' : 'text-pz-muted'}`}
          title="Toggle auto-scroll"
        >
          <ChevronDown size={12} /> Auto-scroll
        </button>
        <button
          onClick={() => { navigator.clipboard.writeText(logs.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          className="btn-ghost text-xs py-1 px-2 flex-shrink-0" title="Copy everything (handy for asking for help)"
        >
          {copied ? <CheckCircle size={12} className="text-pz-green" /> : <Copy size={12} />}
        </button>
        <button onClick={() => clearConsoleLogs(profile.id)} className="btn-ghost text-xs py-1 px-2 flex-shrink-0" title="Clear">
          <Trash2 size={12} />
        </button>
      </div>

      <div
        ref={consoleRef}
        className="flex-1 overflow-y-auto p-4 bg-pz-darker console-output select-text"
        onScroll={(e) => {
          const el = e.currentTarget
          setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 50)
        }}
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Terminal size={28} className="text-pz-muted" />
            <p className="text-pz-muted text-sm">
              {status === 'stopped' ? 'Start the server to see what it is doing here.' : 'Waiting for server output...'}
            </p>
          </div>
        ) : (
          logs.map((line, i) => (
            <div key={i} className={`leading-relaxed whitespace-pre-wrap break-all ${lineColor(line)}`}>{line || ' '}</div>
          ))
        )}
      </div>

      <div className="flex-shrink-0 border-t border-pz-border bg-pz-darker p-3">
        <form onSubmit={e => { e.preventDefault(); send(command.trim()); setCommand('') }} className="flex gap-2">
          <span className="flex items-center text-pz-green font-mono text-sm mr-1">{'>'}</span>
          <input
            type="text"
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            className="input flex-1 font-mono text-sm"
            placeholder={canSend ? 'Type a server command... (↑↓ for history)' : status === 'starting' ? 'Wait for the server to finish starting...' : 'Server is not running'}
            disabled={!canSend}
          />
          <button type="submit" disabled={!canSend || !command.trim()} className="btn-primary"><Send size={14} /></button>
        </form>
        <p className="text-xs text-pz-muted mt-1 ml-5">
          Handy: <code>setaccesslevel &lt;name&gt; admin</code> · <code>kickuser &lt;name&gt;</code> · <code>banuser &lt;name&gt;</code> · <code>servermsg "hi"</code>
        </p>
      </div>
    </div>
  )
}
