import { useCallback, useEffect, useState } from 'react'

import { chatApi } from '@/lib/api'

import { extractApiError } from '../chatHelpers'

const ATTACHMENT_URL_REFRESH_BUFFER_MS = 30_000
const ATTACHMENT_URL_MIN_TTL_MS = 60_000
const ATTACHMENT_URL_MAX_TTL_MS = 10 * 60_000

interface CachedAttachmentDownloadUrl {
  url: string
  expiresAt: number
  promise?: Promise<string>
}

const attachmentDownloadUrlCache = new Map<string, CachedAttachmentDownloadUrl>()

function getCacheKey(chatId: string, fileId: string): string {
  return `${chatId}:${fileId}`
}

function normalizeTtlMs(expiresInSeconds: unknown): number {
  const rawMs = Number(expiresInSeconds) * 1000
  if (!Number.isFinite(rawMs) || rawMs <= 0) return ATTACHMENT_URL_MIN_TTL_MS
  return Math.max(ATTACHMENT_URL_MIN_TTL_MS, Math.min(ATTACHMENT_URL_MAX_TTL_MS, Math.floor(rawMs)))
}

async function fetchAttachmentDownloadUrl(chatId: string, fileId: string, cacheKey: string): Promise<string> {
  const existing = attachmentDownloadUrlCache.get(cacheKey)
  const promise = (async () => {
    const response = await chatApi.getAttachmentDownloadUrl(chatId, fileId)
    if (!response.data.ok || !response.data.data) {
      throw new Error(response.data.error?.message || 'Не удалось получить ссылку на вложение')
    }
    const payload = response.data.data
    const ttlMs = normalizeTtlMs(payload.expires_in)
    attachmentDownloadUrlCache.set(cacheKey, {
      url: payload.url,
      expiresAt: Date.now() + ttlMs,
    })
    return payload.url
  })()

  attachmentDownloadUrlCache.set(cacheKey, {
    url: existing?.url || '',
    expiresAt: existing?.expiresAt || 0,
    promise,
  })

  try {
    return await promise
  } catch (error) {
    attachmentDownloadUrlCache.delete(cacheKey)
    throw error
  }
}

export async function resolveAttachmentDownloadUrl(
  chatId: string,
  fileId: string,
  options: {
    forceRefresh?: boolean
    allowStaleOnRefreshWindow?: boolean
  } = {},
): Promise<string> {
  const cacheKey = getCacheKey(chatId, fileId)
  const now = Date.now()
  const cached = attachmentDownloadUrlCache.get(cacheKey)

  if (cached?.promise) {
    if (!options.forceRefresh) return cached.promise
  }

  if (!options.forceRefresh && cached?.url) {
    if (cached.expiresAt - ATTACHMENT_URL_REFRESH_BUFFER_MS > now) {
      return cached.url
    }

    if (cached.expiresAt > now && options.allowStaleOnRefreshWindow) {
      if (!cached.promise) {
        void fetchAttachmentDownloadUrl(chatId, fileId, cacheKey)
      }
      return cached.url
    }
  }

  return fetchAttachmentDownloadUrl(chatId, fileId, cacheKey)
}

export function useAttachmentDownloadUrl({
  chatId,
  fileId,
  enabled,
  telemetryEnabled,
}: {
  chatId: string
  fileId: string
  enabled: boolean
  telemetryEnabled: boolean
}) {
  const [downloadUrl, setDownloadUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')

  const ensureDownloadUrl = useCallback(async (forceRefresh = false): Promise<string> => {
    setErrorText('')
    setLoading(true)
    try {
      const url = await resolveAttachmentDownloadUrl(chatId, fileId, {
        forceRefresh,
        allowStaleOnRefreshWindow: true,
      })
      if (telemetryEnabled) {
        void chatApi.sendTelemetry({ event: 'attachment_fetch', value: 1, meta: { cached: Boolean(downloadUrl) } })
      }
      setDownloadUrl(url)
      return url
    } catch (error: unknown) {
      const errorMessage = extractApiError(error, 'Не удалось загрузить вложение')
      setErrorText(errorMessage)
      if (telemetryEnabled) {
        void chatApi.sendTelemetry({ event: 'attachment_fetch', value: 0, meta: { error: errorMessage } })
      }
      throw new Error(errorMessage)
    } finally {
      setLoading(false)
    }
  }, [chatId, downloadUrl, fileId, telemetryEnabled])

  useEffect(() => {
    if (!enabled) return
    if (downloadUrl) return
    void ensureDownloadUrl(false)
  }, [downloadUrl, enabled, ensureDownloadUrl])

  useEffect(() => {
    setDownloadUrl('')
    setLoading(false)
    setErrorText('')
  }, [chatId, fileId])

  return {
    downloadUrl,
    loading,
    errorText,
    setErrorText,
    ensureDownloadUrl,
  }
}
