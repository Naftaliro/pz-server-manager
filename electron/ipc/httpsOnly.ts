// Where a redirect goes, only ever https (GitHub and Steam send downloads on to their file
// servers). null for anything else: a program the app downloads (an update, SteamCMD) never
// comes over plain http, not even halfway
export function redirectTarget(from: string, location: string): string | null {
  try {
    const next = new URL(location, from)
    return next.protocol === 'https:' ? next.href : null
  } catch {
    return null
  }
}
