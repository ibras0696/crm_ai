import { useEffect, useRef, useCallback } from 'react'
import { ensureFreshAuth } from '@/lib/api/core/client'

type NotificationHandler = (event: Record<string, unknown>) => void

// Singleton WS connection
let globalSocket: WebSocket | null = null
const globalHandlers = new Set<NotificationHandler>()
let globalReconnectTimer: ReturnType<typeof setTimeout> | null = null
let globalPingTimer: ReturnType<typeof setInterval> | null = null

function clearGlobalPing() {
  if (globalPingTimer) {
    clearInterval(globalPingTimer)
    globalPingTimer = null
  }
}

function connectWS() {
  if (globalSocket && globalSocket.readyState === WebSocket.OPEN) return

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/notifications`

  globalSocket = new WebSocket(wsUrl)

  globalSocket.onopen = () => {
    // Keepalive: without periodic traffic the idle socket is dropped by
    // Cloudflare (~100s) / nginx, causing a constant reconnect churn.
    clearGlobalPing()
    globalPingTimer = setInterval(() => {
      if (globalSocket?.readyState === WebSocket.OPEN) globalSocket.send('ping')
    }, 25_000)
  }

  globalSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as Record<string, unknown>
      globalHandlers.forEach((handler) => handler(data))
    } catch {
      // ignore parse errors (e.g. the 'pong' keepalive frame)
    }
  }

  globalSocket.onclose = () => {
    clearGlobalPing()
    if (globalHandlers.size > 0) {
      // Refresh the auth cookie before reconnecting so an expired access token
      // doesn't trap the socket in a failed-auth (1008) loop.
      globalReconnectTimer = setTimeout(() => {
        void ensureFreshAuth().catch(() => undefined).finally(connectWS)
      }, 3000)
    }
  }

  globalSocket.onerror = () => {
    globalSocket?.close()
  }
}

export function useNotificationsWS(onEvent: NotificationHandler) {
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  const stableHandler = useCallback((event: Record<string, unknown>) => {
    handlerRef.current(event)
  }, [])

  useEffect(() => {
    globalHandlers.add(stableHandler)
    connectWS()

    return () => {
      globalHandlers.delete(stableHandler)
      if (globalHandlers.size === 0) {
        if (globalReconnectTimer) {
          clearTimeout(globalReconnectTimer)
          globalReconnectTimer = null
        }
        clearGlobalPing()
        globalSocket?.close()
        globalSocket = null
      }
    }
  }, [stableHandler])
}
