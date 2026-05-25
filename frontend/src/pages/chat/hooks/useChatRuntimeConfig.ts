import { useEffect, useState } from 'react'

import { chatApi } from '@/lib/api'
import { isChatRolloutEnabledByEnv, isChatTelemetryEnabledByEnv } from '@/lib/featureFlags'

interface ChatRuntimeConfig {
  realtimeEnabled: boolean
  telemetryEnabled: boolean
  rolloutPercent: number
}

const DEFAULT_ROLLOUT_PERCENT = 100

const DEFAULT_CONFIG: ChatRuntimeConfig = {
  realtimeEnabled: isChatRolloutEnabledByEnv(),
  telemetryEnabled: isChatTelemetryEnabledByEnv(),
  rolloutPercent: DEFAULT_ROLLOUT_PERCENT,
}

export function useChatRuntimeConfig() {
  const [config, setConfig] = useState<ChatRuntimeConfig>(DEFAULT_CONFIG)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await chatApi.getClientConfig()
        if (!response.data.ok || !response.data.data || cancelled) return
        const payload = response.data.data
        setConfig({
          realtimeEnabled: Boolean(payload.realtime_enabled),
          telemetryEnabled: Boolean(payload.telemetry_enabled),
          rolloutPercent: Number(payload.realtime_rollout_percent) || DEFAULT_ROLLOUT_PERCENT,
        })
      } catch {
        // env defaults are already applied
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return config
}
