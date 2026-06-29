import { useCallback, useState } from 'react'
import { callsApi } from '../lib/api/calls'

export function useCallRoom() {
  const [token, setToken] = useState<string | null>(null)
  const [liveKitUrl, setLiveKitUrl] = useState<string | null>(null)
  const [hostId, setHostId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const joinRoom = useCallback(async (slug: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await callsApi.joinRoom(slug)
      const { livekit_token, livekit_url, room } = res.data.data
      setToken(livekit_token)
      setLiveKitUrl(livekit_url)
      setHostId(room.host_id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const leaveRoom = useCallback(async (slug: string) => {
    setToken(null)
    setLiveKitUrl(null)
    setHostId(null)
    try {
      await callsApi.leaveRoom(slug)
    } catch {
      // fire and forget
    }
  }, [])

  return { token, liveKitUrl, hostId, isLoading, error, joinRoom, leaveRoom }
}
