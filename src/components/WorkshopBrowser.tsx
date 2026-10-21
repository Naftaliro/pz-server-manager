import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Home, RotateCw, Search, Plus, Check, Loader, AlertTriangle, Layers, ExternalLink } from 'lucide-react'
import { formatBytes } from '../lib/profile'

// The real Steam Workshop in a webview. We don't scrape anything to find mods any more:
// the user browses Steam normally and we watch which item page they're on, then use
// Steam's keyless details API for the rest. On browse pages a small script adds "+"
// buttons to the tiles and talks back through console messages.

const BASE = 'https://steamcommunity.com/workshop/browse/?appid=108600&section=readytouseitems'
const MSG_PREFIX = '__PZM__:'

type Sort = 'popular' | 'trend' | 'recent' | 'updated'
const SORTS: Record<Sort, { label: string; params: string }> = {
  popular: { label: 'Most popular', params: '&browsesort=trend&actualsort=trend&days=-1' },
  trend: { label: 'Trending this week', params: '&browsesort=trend&actualsort=trend&days=7' },
  recent: { label: 'Newest', params: '&browsesort=mostrecent&actualsort=mostrecent' },
  updated: { label: 'Recently updated', params: '&browsesort=lastupdated&actualsort=lastupdated' },
}

function browseUrl(query: string, sort: Sort, b42Only: boolean): string {
  const tag = b42Only ? '&requiredtags[]=Build+42' : ''
  if (query.trim()) {
    return `${BASE}&searchtext=${encodeURIComponent(query.trim())}&browsesort=textsearch&actualsort=textsearch&days=-1${tag}`
  }
  return `${BASE}${SORTS[sort].params}${tag}`
}

function itemIdFromUrl(url: string): string | null {
  const m = url.match(/filedetails\/\?id=(\d+)/)
  return m ? m[1] : null
}

// Hide the bits of the Steam page that don't make sense in here
const PAGE_CSS = `
  #global_header, .responsive_header, #footer, #footer_spacer, .responsive_page_menu_ctn,
  #SubscribeItemBtn, .subscribeOption, .game_area_purchase_game { display: none !important; }
  .pzm-add {
    position: absolute; top: 6px; right: 6px; z-index: 50;
    border: none; border-radius: 6px; padding: 4px 10px; cursor: pointer;
    font: 600 12px/1.4 "Segoe UI", sans-serif; background: #cba6f7; color: #181825;
    box-shadow: 0 2px 8px rgba(0,0,0,.4);
  }
  .pzm-add[data-added="1"] { background: #a6e3a1; }
`

// Runs inside the Steam page. Adds a button on every workshop tile on browse/search pages.
const PAGE_SCRIPT = `
(() => {
  if (window.__pzmInstalled) { window.__pzmRefresh && window.__pzmRefresh(); return; }
  window.__pzmInstalled = true;
  const send = (type, data) => console.log('${MSG_PREFIX}' + JSON.stringify({ type, ...data }));
  const isBrowse = () => location.pathname.startsWith('/workshop/browse');
  const idOf = (href) => { const m = (href || '').match(/filedetails\\/\\?id=(\\d+)/); return m ? m[1] : null; };
  const paint = (btn) => {
    const added = (window.__pzmAdded || []).includes(btn.dataset.id);
    btn.dataset.added = added ? '1' : '0';
    btn.textContent = added ? '✓ Added' : '+ Add';
  };
  const decorate = () => {
    if (!isBrowse()) return;
    document.querySelectorAll('a[href*="filedetails/?id="]').forEach((a) => {
      const id = idOf(a.getAttribute('href'));
      if (!id || !a.querySelector('img') || a.querySelector('.pzm-add')) return;
      if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
      const btn = document.createElement('button');
      btn.className = 'pzm-add';
      btn.dataset.id = id;
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        send(btn.dataset.added === '1' ? 'open' : 'add', { id });
      });
      paint(btn);
      a.appendChild(btn);
    });
  };
  window.__pzmRefresh = () => { document.querySelectorAll('.pzm-add').forEach(paint); decorate(); };
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(decorate, 250); })
    .observe(document.documentElement, { childList: true, subtree: true });
  decorate();
})();
`

// Runs inside an item page and returns the "Required items" list Steam shows there
const REQUIRED_SCRIPT = `
(() => {
  const box = document.querySelector('#RequiredItems, .requiredItemsContainer, [class*="requiredItems"]');
  if (!box) return [];
  const ids = [];
  box.querySelectorAll('a[href*="?id="]').forEach((a) => {
    const m = a.getAttribute('href').match(/id=(\\d+)/);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  });
  return ids;
})()
`

interface ItemState {
  id: string
  loading: boolean
  details?: WorkshopModDetails
  collection?: WorkshopModDetails[]
  required: WorkshopModDetails[]
  error?: string
}

interface Props {
  addedIds: string[]
  buildVersion: 'b41' | 'b42'
  onAdd: (items: WorkshopModDetails[]) => Promise<void> | void
  // bump nonce to make the browser run a search from outside (e.g. "find missing mod")
  searchRequest?: { query: string; nonce: number }
}

export default function WorkshopBrowser({ addedIds, buildVersion, onAdd, searchRequest }: Props) {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  // webview methods throw until its first dom-ready, so everything goes through wv()
  const readyRef = useRef(false)
  const wv = () => (readyRef.current ? webviewRef.current : null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('popular')
  const [b42Only, setB42Only] = useState(buildVersion !== 'b41')
  const [url, setUrl] = useState(() => browseUrl('', 'popular', buildVersion !== 'b41'))
  const [loading, setLoading] = useState(true)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [item, setItem] = useState<ItemState | null>(null)
  const [skipRequired, setSkipRequired] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState('')
  const [initialSrc] = useState(url)

  // keep latest values for the webview event handlers
  const addedRef = useRef(addedIds)
  addedRef.current = addedIds
  const onAddRef = useRef(onAdd)
  onAddRef.current = onAdd

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const pushAddedToPage = () => {
    wv()?.executeJavaScript(`window.__pzmAdded = ${JSON.stringify(addedRef.current)}; window.__pzmRefresh && window.__pzmRefresh();`).catch(() => undefined)
  }

  useEffect(() => { pushAddedToPage() }, [addedIds])

  const loadItem = async (id: string) => {
    setItem({ id, loading: true, required: [] })
    setSkipRequired([])
    try {
      const [detailRes, collectionRes] = await Promise.all([
        window.electronAPI.mods.getDetails([id]),
        window.electronAPI.mods.getCollection(id),
      ])
      if (collectionRes.success && collectionRes.isCollection) {
        setItem({ id, loading: false, collection: collectionRes.mods, required: [], details: detailRes.mods[0] })
        return
      }
      const details = detailRes.mods[0]
      if (!details) {
        setItem({ id, loading: false, required: [], error: "Couldn't load this mod's details from Steam." })
        return
      }
      setItem({ id, loading: false, details, required: [] })

      // required items come from the page itself once it has rendered
      let requiredIds: string[] = []
      for (let tries = 0; tries < 6 && requiredIds.length === 0; tries++) {
        await new Promise(r => setTimeout(r, 700))
        if (itemIdFromUrl(wv()?.getURL() || '') !== id) return
        requiredIds = await wv()?.executeJavaScript(REQUIRED_SCRIPT).catch(() => []) || []
        if (requiredIds.length === 0 && tries >= 2) break
      }
      requiredIds = requiredIds.filter(r => r !== id)
      if (requiredIds.length > 0) {
        const req = await window.electronAPI.mods.getDetails(requiredIds)
        setItem(prev => (prev && prev.id === id ? { ...prev, required: req.mods } : prev))
      }
    } catch (e) {
      setItem({ id, loading: false, required: [], error: e instanceof Error ? e.message : String(e) })
    }
  }

  // quick-add from a tile skips the required-items check (that needs the item page open),
  // the Mods tab flags anything missing once the files are downloaded
  const quickAdd = async (id: string) => {
    const res = await window.electronAPI.mods.getDetails([id])
    if (res.mods[0]) {
      await onAddRef.current(res.mods)
      showToast(`Added ${res.mods[0].name}`)
    } else {
      showToast("Couldn't load that mod from Steam")
    }
  }

  useEffect(() => {
    const view = webviewRef.current
    if (!view) return

    const onNavigate = () => {
      if (!readyRef.current) return
      const current = view.getURL()
      setUrl(current)
      setCanBack(view.canGoBack())
      setCanForward(view.canGoForward())
      const id = itemIdFromUrl(current)
      if (id) loadItem(id)
      else setItem(null)
    }
    const onDomReady = () => {
      const first = !readyRef.current
      readyRef.current = true
      view.insertCSS(PAGE_CSS).catch(() => undefined)
      view.executeJavaScript(PAGE_SCRIPT).catch(() => undefined)
      pushAddedToPage()
      // did-navigate for the very first page fires before dom-ready, so catch up here
      if (first) onNavigate()
    }
    const onConsole = (e: Electron.ConsoleMessageEvent) => {
      if (!e.message.startsWith(MSG_PREFIX)) return
      try {
        const msg = JSON.parse(e.message.slice(MSG_PREFIX.length))
        if (msg.type === 'add') quickAdd(msg.id)
        if (msg.type === 'open') view.loadURL(`https://steamcommunity.com/sharedfiles/filedetails/?id=${msg.id}`)
      } catch { /* not ours */ }
    }
    const onStart = () => setLoading(true)
    const onStop = () => setLoading(false)

    view.addEventListener('did-navigate', onNavigate)
    view.addEventListener('did-navigate-in-page', onNavigate)
    view.addEventListener('dom-ready', onDomReady)
    view.addEventListener('console-message', onConsole)
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    return () => {
      view.removeEventListener('did-navigate', onNavigate)
      view.removeEventListener('did-navigate-in-page', onNavigate)
      view.removeEventListener('dom-ready', onDomReady)
      view.removeEventListener('console-message', onConsole)
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
    }
  }, [])

  const go = (target: string) => { wv()?.loadURL(target).catch(() => undefined) }
  const runSearch = (q = query, s = sort, b = b42Only) => go(browseUrl(q, s, b))

  useEffect(() => {
    if (!searchRequest) return
    setQuery(searchRequest.query)
    // search all builds, a missing requirement might not be tagged
    runSearch(searchRequest.query, sort, false)
  }, [searchRequest?.nonce])

  const addCurrent = async () => {
    if (!item) return
    setAdding(true)
    try {
      if (item.collection) {
        await onAdd(item.collection)
        showToast(`Added ${item.collection.filter(m => !addedIds.includes(m.workshopId)).length} mods from the collection`)
      } else if (item.details) {
        const deps = item.required.filter(r => !skipRequired.includes(r.workshopId))
        await onAdd([...deps, item.details])
        showToast(deps.length ? `Added ${item.details.name} and ${deps.length} required mod${deps.length > 1 ? 's' : ''}` : `Added ${item.details.name}`)
      }
    } finally {
      setAdding(false)
    }
  }

  const isAdded = (id: string) => addedIds.includes(id)
  const notTaggedB42 = item?.details && buildVersion !== 'b41' && !item.collection &&
    !item.details.tags.some(t => /build\s*42/i.test(t))

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-pz-border bg-pz-darker flex-shrink-0 flex-wrap">
        <button onClick={() => wv()?.goBack()} disabled={!canBack} className="btn-ghost p-1.5 disabled:opacity-30" title="Back">
          <ArrowLeft size={14} />
        </button>
        <button onClick={() => wv()?.goForward()} disabled={!canForward} className="btn-ghost p-1.5 disabled:opacity-30" title="Forward">
          <ArrowRight size={14} />
        </button>
        <button onClick={() => { setQuery(''); runSearch('') }} className="btn-ghost p-1.5" title="Workshop home">
          <Home size={14} />
        </button>
        <button onClick={() => wv()?.reload()} className="btn-ghost p-1.5" title="Reload">
          {loading ? <Loader size={14} className="animate-spin" /> : <RotateCw size={14} />}
        </button>

        <form
          className="flex-1 min-w-48 flex items-center gap-2 bg-pz-dark border border-pz-border rounded-md px-2"
          onSubmit={e => { e.preventDefault(); runSearch() }}
        >
          <Search size={14} className="text-pz-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the Steam Workshop..."
            className="flex-1 bg-transparent py-1.5 text-sm text-pz-text placeholder:text-pz-muted outline-none"
          />
        </form>

        <select
          value={sort}
          onChange={e => { const s = e.target.value as Sort; setSort(s); if (!query.trim()) runSearch(query, s) }}
          className="bg-pz-dark border border-pz-border rounded-md px-2 py-1.5 text-sm text-pz-text"
          title="Sort"
        >
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        {buildVersion !== 'b41' && (
          <label className="flex items-center gap-1.5 text-xs text-pz-subtext cursor-pointer select-none">
            <input
              type="checkbox"
              checked={b42Only}
              onChange={e => { setB42Only(e.target.checked); runSearch(query, sort, e.target.checked) }}
              className="accent-pz-green"
            />
            Build 42 only
          </label>
        )}

        <button onClick={() => window.electronAPI.shell.openExternal(url)} className="btn-ghost p-1.5" title="Open in your browser">
          <ExternalLink size={14} />
        </button>
      </div>

      {/* What you're looking at + the add button */}
      {item && (
        <div className="px-4 py-3 border-b border-pz-border bg-pz-card flex-shrink-0">
          {item.loading ? (
            <div className="flex items-center gap-2 text-sm text-pz-muted"><Loader size={14} className="animate-spin" /> Loading mod info...</div>
          ) : item.error ? (
            <div className="flex items-center gap-2 text-sm text-pz-red"><AlertTriangle size={14} /> {item.error}</div>
          ) : item.collection ? (
            <div className="flex items-center gap-3">
              <Layers size={20} className="text-pz-green flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-pz-text truncate">{item.details?.name || 'Collection'}</div>
                <div className="text-xs text-pz-muted">
                  Collection with {item.collection.length} mods
                  {' · '}{item.collection.filter(m => isAdded(m.workshopId)).length} already added
                  {' · '}{formatBytes(item.collection.reduce((n, m) => n + m.fileSize, 0))} total
                </div>
              </div>
              {item.collection.every(m => isAdded(m.workshopId)) ? (
                <span className="btn-ghost text-pz-green"><Check size={14} /> All added</span>
              ) : (
                <button onClick={addCurrent} disabled={adding} className="btn-primary">
                  <Plus size={14} /> {adding ? 'Adding...' : `Add all ${item.collection.filter(m => !isAdded(m.workshopId)).length}`}
                </button>
              )}
            </div>
          ) : item.details && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                {item.details.thumbnailUrl && <img src={item.details.thumbnailUrl} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-pz-text truncate">{item.details.name}</div>
                  <div className="text-xs text-pz-muted">
                    {formatBytes(item.details.fileSize)}
                    {item.details.tags.length > 0 && ` · ${item.details.tags.slice(0, 4).join(', ')}`}
                  </div>
                </div>
                {isAdded(item.id) ? (
                  <span className="btn-ghost text-pz-green"><Check size={14} /> Added</span>
                ) : (
                  <button onClick={addCurrent} disabled={adding} className="btn-primary">
                    <Plus size={14} /> {adding ? 'Adding...' : 'Add to server'}
                  </button>
                )}
              </div>

              {notTaggedB42 && (
                <p className="text-xs text-pz-yellow flex items-center gap-1.5">
                  <AlertTriangle size={12} /> This mod isn't tagged for Build 42, it might be B41-only.
                </p>
              )}
              {item.details.fileSize > 1024 ** 3 && (
                <p className="text-xs text-pz-subtext">Heads up: this one is a big download ({formatBytes(item.details.fileSize)}).</p>
              )}

              {item.required.length > 0 && (
                <div className="text-xs">
                  <p className="text-pz-subtext mb-1">This mod needs these too{isAdded(item.id) ? '' : ' (they get added with it)'}:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.required.map(r => {
                      const already = isAdded(r.workshopId)
                      const skipped = skipRequired.includes(r.workshopId)
                      return (
                        <button
                          key={r.workshopId}
                          disabled={already || isAdded(item.id)}
                          onClick={() => setSkipRequired(prev => skipped ? prev.filter(x => x !== r.workshopId) : [...prev, r.workshopId])}
                          className={`px-2 py-0.5 rounded border transition-colors ${
                            already ? 'border-pz-green/40 text-pz-green' :
                            skipped ? 'border-pz-border text-pz-muted line-through' :
                            'bg-pz-green/15 border-pz-green text-pz-green'
                          }`}
                          title={already ? 'Already in your list' : skipped ? 'Click to include' : 'Click to skip'}
                        >
                          {already ? '✓ ' : ''}{r.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="relative flex-1 min-h-0 bg-pz-darker">
        <webview
          ref={webviewRef as unknown as React.Ref<HTMLElement>}
          src={initialSrc}
          partition="persist:workshop"
          style={{ width: '100%', height: '100%', display: 'flex' }}
        />
        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-pz-card border border-pz-green/40 text-pz-text text-sm px-4 py-2 rounded-lg shadow-xl">
            {toast}
          </div>
        )}
      </div>
    </div>
  )
}
