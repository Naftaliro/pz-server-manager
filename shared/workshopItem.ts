// workshop.txt is what the game's Workshop uploader reads (and writes the item id into)

export function buildWorkshopTxt(opts: {
  title: string
  description: string
  needs: Array<{ name: string; workshopId?: string }>
}): string {
  const lines = [opts.description.trim() || 'A small fix mod for my server.', '']
  if (opts.needs.length > 0) {
    lines.push('Needs these mods (all credit to their authors, this contains none of their files):')
    for (const n of opts.needs) {
      lines.push(n.workshopId ? `[url=https://steamcommunity.com/sharedfiles/filedetails/?id=${n.workshopId}]${n.name}[/url]` : n.name)
    }
  }
  return [
    'version=1',
    `title=${opts.title.replace(/[\r\n]+/g, ' ')}`,
    // one description= per line is how the game stores multi-line text
    ...lines.map(l => `description=${l}`),
    'tags=',
    // works for anyone who has the link (like the server), doesn't show up in searches
    'visibility=unlisted',
    '',
  ].join('\r\n')
}

export function readWorkshopId(txt: string): string | null {
  const id = txt.match(/^\s*id\s*=\s*(\d+)\s*$/m)?.[1]
  return id || null
}

// B42 ids like "2256623447/firearmmod" belong to that Workshop item (the number is its
// id), so the game's uploader tries to update that item instead of making a new one.
// A mod with such an id (like a shim answering to an old id) has to stay local
export function cantUploadReason(modId: string): string | null {
  const owner = modId.match(/^(\d+)\//)?.[1]
  if (!owner) return null
  return `This mod's ID (${modId}) belongs to Workshop item ${owner}, so it can't be uploaded as its own item: the game would try to update that item instead. Keep it as a local fix, the server pack gives it to your friends.`
}
