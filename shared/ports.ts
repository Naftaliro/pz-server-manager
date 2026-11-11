// Ports and names for a new server (the create wizard, "Make a copy", hosting a copy of a
// pack), so two servers can run side by side. No Node or browser APIs in here.

interface PortsOf {
  port: number
  udpPort?: number
  iniSettings?: Record<string, unknown>
}

// A game port (it also uses the next one up) that no other server has, from 16261 in steps of 2
export function freeGamePort(profiles: PortsOf[]): number {
  const used = new Set(profiles.flatMap(p => [p.port, p.udpPort ?? p.port + 1]))
  let port = 16261
  while (used.has(port) || used.has(port + 1)) port += 2
  return port
}

// An RCON port no other server has, from 27015
export function freeRconPort(profiles: PortsOf[]): number {
  const used = new Set(profiles.map(p => Number(p.iniSettings?.RCONPort || 27015)))
  let port = 27015
  while (used.has(port)) port++
  return port
}

// "Base (Copy)", then "Base (Copy 2)", "Base (Copy 3)"... A copy of a copy counts on from it
export function copyName(name: string, taken: string[]): string {
  const base = name.replace(/\s*\(Copy(?: \d+)?\)$/, '')
  const used = new Set(taken.map(n => n.trim().toLowerCase()))
  let candidate = `${base} (Copy)`
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (Copy ${n})`
  return candidate
}
