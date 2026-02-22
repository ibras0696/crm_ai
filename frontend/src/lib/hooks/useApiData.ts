import { useState, useCallback, useEffect } from 'react'
import type { AxiosResponse } from 'axios'
import type { ApiResponse } from '@/lib/api/types'

/**
 * Generic hook for simple data fetching with loading state.
 * Replaces the repeated useState+useCallback+useEffect+try/catch pattern
 * that appears in ~12 pages.
 *
 * @param fetcher - async function returning AxiosResponse<ApiResponse<T>>
 * @param initial - initial value for data before fetch completes
 * @param deps    - extra deps for useCallback (default empty, fetcher reference is the dep)
 */
export function useApiData<T>(
  fetcher: () => Promise<AxiosResponse<ApiResponse<T>>>,
  initial: T,
) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetcher()
      if (r.data.ok && r.data.data != null) setData(r.data.data)
    } catch {
      // ignore — pages handle error states individually if needed
    }
    setLoading(false)
  }, [fetcher])

  useEffect(() => { void load() }, [load])

  return { data, loading, reload: load, setData }
}
