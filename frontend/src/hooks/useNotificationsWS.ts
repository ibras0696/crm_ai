import { useEffect, useRef, useCallback } from 'react'

type NotificationHandler = (event: Record<string, unknown>) => void

// Singleton WS connection
let globalSocket: WebSocket | null = null
const globalHandlers = new Set<NotificationHandler>()
let globalReconnectTimer: ReturnType<typeof setTimeout> | null = null

function connectWS() {
  if (globalSocket && globalSocket.readyState === WebSocket.OPEN) return

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/notifications`

  globalSocket = new WebSocket(wsUrl)

  globalSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as Record<string, unknown>
      globalHandlers.forEach((handler) => handler(data))
    } catch {
      // ignore parse errors
    }
  }

  globalSocket.onclose = () => {
    if (globalHandlers.size > 0) {
      // reconnect after 3s if someone is still listening
      globalReconnectTimer = setTimeout(connectWS, 3000)
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
        globalSocket?.close()
        globalSocket = null
      }
    }
  }, [stableHandler])
}
