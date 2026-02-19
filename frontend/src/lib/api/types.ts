export interface ApiResponse<T> {
  ok: boolean
  data: T | null
  error: { code: string; message: string; field?: string } | null
}
