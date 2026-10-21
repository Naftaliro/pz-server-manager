import net from 'net'

// Minimal Source RCON client, PZ servers speak this on RCONPort.
// One connection per command, keeps it simple and nothing to clean up.

const SERVERDATA_AUTH = 3
const SERVERDATA_EXECCOMMAND = 2

function packet(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf-8')
  const buf = Buffer.alloc(14 + bodyBuf.length)
  buf.writeInt32LE(10 + bodyBuf.length, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  bodyBuf.copy(buf, 12)
  // two trailing null bytes are already 0 from alloc
  return buf
}

export function rconCommand(port: number, password: string, command: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let data = Buffer.alloc(0)
    let authed = false
    let output = ''
    let settleTimer: NodeJS.Timeout | null = null

    let finished = false
    const finish = (err?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (settleTimer) clearTimeout(settleTimer)
      socket.destroy()
      if (err) reject(err)
      else resolve(output.trim())
    }
    const timer = setTimeout(() => {
      // got some output but the server never closed, that's fine
      if (authed) finish()
      else finish(new Error('RCON timed out'))
    }, timeoutMs)

    socket.on('connect', () => socket.write(packet(1, SERVERDATA_AUTH, password)))
    // once we're logged in, the server hanging up (e.g. after "quit") just means it's done
    socket.on('error', (e) => (authed ? finish() : finish(e)))
    socket.on('close', () => (authed ? finish() : finish(new Error('RCON connection closed'))))
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk])
      while (data.length >= 4) {
        const size = data.readInt32LE(0)
        if (data.length < size + 4) break
        const id = data.readInt32LE(4)
        const type = data.readInt32LE(8)
        const body = data.toString('utf-8', 12, 4 + size - 2)
        data = data.subarray(size + 4)

        if (!authed) {
          // auth response is type 2, id -1 means bad password
          if (type === 2) {
            if (id === -1) return finish(new Error('RCON password rejected'))
            authed = true
            socket.write(packet(2, SERVERDATA_EXECCOMMAND, command))
          }
          continue
        }
        if (id === 2) {
          output += body
          // responses can be split, wait a moment for more before finishing
          if (settleTimer) clearTimeout(settleTimer)
          settleTimer = setTimeout(() => finish(), 300)
        }
      }
    })
  })
}
