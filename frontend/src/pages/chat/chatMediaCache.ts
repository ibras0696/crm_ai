const CHAT_MEDIA_CACHE_NAME = 'crm-chat-media-cache-v1'
const CHAT_MEDIA_CACHE_MANIFEST_KEY = 'crm.chat.mediaCache.manifest.v1'
const CHAT_MEDIA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CHAT_MEDIA_CACHE_MAX_ITEM_BYTES = 25 * 1024 * 1024
const CHAT_MEDIA_CACHE_MAX_TOTAL_BYTES = 250 * 1024 * 1024

interface ChatMediaCacheMeta {
  key: string
  cacheId: string
  fileId: string
  contentType: string
  size: number
  cachedAt: number
  lastAccessedAt: number
}

type ChatMediaCacheManifest = Record<string, ChatMediaCacheMeta>

interface ResolveCachedMediaUrlOptions {
  cacheId: string
  fileId: string
  sourceUrl: string
  contentType: string
  sizeBytes?: number
}

function canUseBrowserMediaCache(): boolean {
  return typeof window !== 'undefined' && 'caches' in window && typeof URL.createObjectURL === 'function'
}

function getMediaCacheRequest(cacheId: string): Request {
  return new Request(`/__crm_chat_media_cache__/${encodeURIComponent(cacheId)}`)
}

function readManifest(): ChatMediaCacheManifest {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CHAT_MEDIA_CACHE_MANIFEST_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as ChatMediaCacheManifest : {}
  } catch {
    return {}
  }
}

function writeManifest(manifest: ChatMediaCacheManifest) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CHAT_MEDIA_CACHE_MANIFEST_KEY, JSON.stringify(manifest))
  } catch {
    // If localStorage quota is full, media cache remains a best-effort optimization.
  }
}

function isFresh(meta: ChatMediaCacheMeta, now = Date.now()): boolean {
  return now - meta.cachedAt <= CHAT_MEDIA_CACHE_TTL_MS
}

async function deleteCachedMedia(cacheId: string, manifest: ChatMediaCacheManifest, cache: Cache) {
  await cache.delete(getMediaCacheRequest(cacheId))
  delete manifest[cacheId]
}

async function pruneMediaCache(manifest: ChatMediaCacheManifest, cache: Cache) {
  const now = Date.now()
  for (const meta of Object.values(manifest)) {
    if (!isFresh(meta, now)) {
      await deleteCachedMedia(meta.cacheId, manifest, cache)
    }
  }

  let totalBytes = Object.values(manifest).reduce((sum, meta) => sum + meta.size, 0)
  if (totalBytes <= CHAT_MEDIA_CACHE_MAX_TOTAL_BYTES) {
    writeManifest(manifest)
    return
  }

  const oldestFirst = Object.values(manifest).sort((left, right) => left.lastAccessedAt - right.lastAccessedAt)
  for (const meta of oldestFirst) {
    if (totalBytes <= CHAT_MEDIA_CACHE_MAX_TOTAL_BYTES) break
    await deleteCachedMedia(meta.cacheId, manifest, cache)
    totalBytes -= meta.size
  }
  writeManifest(manifest)
}

async function readCachedMediaBlob(cacheId: string): Promise<Blob | null> {
  if (!canUseBrowserMediaCache()) return null
  const cache = await window.caches.open(CHAT_MEDIA_CACHE_NAME)
  const manifest = readManifest()
  const meta = manifest[cacheId]
  if (!meta || !isFresh(meta)) {
    if (meta) {
      await deleteCachedMedia(cacheId, manifest, cache)
      writeManifest(manifest)
    }
    return null
  }

  const response = await cache.match(getMediaCacheRequest(cacheId))
  if (!response) {
    delete manifest[cacheId]
    writeManifest(manifest)
    return null
  }

  meta.lastAccessedAt = Date.now()
  writeManifest(manifest)
  return response.blob()
}

async function cacheMediaFromSource({
  cacheId,
  fileId,
  sourceUrl,
  contentType,
  sizeBytes,
}: ResolveCachedMediaUrlOptions): Promise<Blob | null> {
  if (!canUseBrowserMediaCache()) return null
  if (typeof sizeBytes === 'number' && sizeBytes > CHAT_MEDIA_CACHE_MAX_ITEM_BYTES) return null

  const response = await fetch(sourceUrl, { method: 'GET' })
  if (!response.ok) return null

  const blob = await response.blob()
  if (blob.size > CHAT_MEDIA_CACHE_MAX_ITEM_BYTES) return null

  const normalizedType = contentType || blob.type || 'application/octet-stream'
  const finalBlob = blob.type === normalizedType ? blob : new Blob([blob], { type: normalizedType })
  const cache = await window.caches.open(CHAT_MEDIA_CACHE_NAME)
  const manifest = readManifest()
  const now = Date.now()
  const request = getMediaCacheRequest(cacheId)

  await cache.put(request, new Response(finalBlob, {
    headers: {
      'Content-Length': String(finalBlob.size),
      'Content-Type': normalizedType,
      'X-CRM-Chat-File-Id': fileId,
    },
  }))

  manifest[cacheId] = {
    key: request.url,
    cacheId,
    fileId,
    contentType: normalizedType,
    size: finalBlob.size,
    cachedAt: now,
    lastAccessedAt: now,
  }
  await pruneMediaCache(manifest, cache)

  return finalBlob
}

export async function resolveCachedMediaObjectUrl(options: ResolveCachedMediaUrlOptions): Promise<string | null> {
  try {
    const cachedBlob = await readCachedMediaBlob(options.cacheId)
    if (cachedBlob) return URL.createObjectURL(cachedBlob)

    const sourceBlob = await cacheMediaFromSource(options)
    if (sourceBlob) return URL.createObjectURL(sourceBlob)
  } catch {
    return null
  }
  return null
}

export function revokeCachedMediaObjectUrl(url: string) {
  if (!url.startsWith('blob:')) return
  URL.revokeObjectURL(url)
}
