import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { isAxiosError } from 'axios'
import { Document, Page, pdfjs } from 'react-pdf'
import { Loader2, Save, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { docsApi, type DocsFile } from '@/lib/api'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

interface PdfSignerPanelProps {
  file: DocsFile
  onClose: () => void
  onError: (message: string) => void
  onFileUpdated: (file: DocsFile) => void
  pollFileStatus: (fileIds: string[]) => Promise<void>
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [drawing, setDrawing] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    onChange(canvas.toDataURL('image/png'))
  }, [onChange])

  const toPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const point = toPoint(event)
    setDrawing(true)
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const point = toPoint(event)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  }

  const onPointerUp = () => {
    if (!drawing) return
    const canvas = canvasRef.current
    setDrawing(false)
    if (!canvas) return
    onChange(canvas.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    onChange(canvas.toDataURL('image/png'))
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={420}
        height={140}
        className="w-full rounded-md border border-input bg-white touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          Очистить
        </Button>
      </div>
    </div>
  )
}

export function PdfSignerPanel({ file, onClose, onError, onFileUpdated, pollFileStatus }: PdfSignerPanelProps) {
  const [loadingPdf, setLoadingPdf] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pdfUrl, setPdfUrl] = useState('')
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [signatureDataUrl, setSignatureDataUrl] = useState('')
  const [placement, setPlacement] = useState({ x: 100, y: 100, width: 170, height: 70 })
  const [pdfPageSize, setPdfPageSize] = useState({ width: 0, height: 0 })
  const pageRef = useRef<HTMLDivElement | null>(null)

  const extractError = (error: unknown, fallback: string): string => {
    if (!isAxiosError(error)) return fallback
    const message = error.response?.data?.error?.message
    if (typeof message === 'string' && message.trim()) return message
    return fallback
  }

  const reloadPdf = useCallback(async () => {
    setLoadingPdf(true)
    try {
      const response = await docsApi.getDownload(file.id)
      if (!response.data.ok || !response.data.data) {
        throw new Error(response.data.error?.message || 'Не удалось получить PDF')
      }
      setPdfUrl(response.data.data.url)
    } catch (error) {
      onError(extractError(error, 'Не удалось загрузить PDF для подписи'))
    } finally {
      setLoadingPdf(false)
    }
  }, [file.id, onError])

  useEffect(() => {
    void reloadPdf()
  }, [reloadPdf])

  const pageScale = useMemo(() => {
    const rect = pageRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return { sx: 1, sy: 1 }
    const sx = pdfPageSize.width > 0 ? pdfPageSize.width / rect.width : 1
    const sy = pdfPageSize.height > 0 ? pdfPageSize.height / rect.height : 1
    return { sx, sy }
  }, [pdfPageSize.width, pdfPageSize.height, pdfUrl, pageNumber])

  const placeByClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = pageRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextX = Math.max(0, Math.min(event.clientX - rect.left, rect.width - placement.width))
    const nextY = Math.max(0, Math.min(event.clientY - rect.top, rect.height - placement.height))
    setPlacement((prev) => ({ ...prev, x: Math.round(nextX), y: Math.round(nextY) }))
  }

  const saveSignature = async () => {
    if (!signatureDataUrl) {
      onError('Сначала нарисуйте подпись')
      return
    }
    setSaving(true)
    try {
      const payload = {
        page: pageNumber,
        x: Math.round(placement.x * pageScale.sx),
        y: Math.round(placement.y * pageScale.sy),
        width: Math.round(placement.width * pageScale.sx),
        height: Math.round(placement.height * pageScale.sy),
        image: signatureDataUrl,
        author: 'signed_via_docs_ui',
      }
      const response = await docsApi.signPdf(file.id, payload)
      if (!response.data.ok || !response.data.data) {
        onError(response.data.error?.message || 'Не удалось поставить подпись')
        return
      }

      onFileUpdated(response.data.data)
      await pollFileStatus([file.id])

      const refreshed = await docsApi.getFile(file.id)
      if (refreshed.data.ok && refreshed.data.data) {
        onFileUpdated(refreshed.data.data)
      }
      await reloadPdf()
    } catch (error) {
      onError(extractError(error, 'Ошибка при сохранении подписи'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-6 space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">PDF подпись: {file.title || file.original_name}</h3>
          <p className="text-xs text-muted-foreground">
            Нарисуйте подпись, кликните по странице для размещения и нажмите «Сохранить подпись».
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          <X className="mr-1 h-4 w-4" /> Закрыть
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {loadingPdf ? (
            <div className="flex h-80 items-center justify-center rounded-md border border-dashed border-border">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-auto rounded-md border border-border p-2">
              <div ref={pageRef} className="relative inline-block cursor-crosshair" onClick={placeByClick}>
                {pdfUrl ? (
                  <Document
                    file={pdfUrl}
                    onLoadSuccess={(info) => {
                      setNumPages(info.numPages)
                      setPageNumber((prev) => Math.min(Math.max(1, prev), info.numPages))
                    }}
                  >
                    <Page
                      pageNumber={pageNumber}
                      width={760}
                      onLoadSuccess={(page) => {
                        setPdfPageSize({ width: page.width, height: page.height })
                      }}
                    />
                  </Document>
                ) : (
                  <div className="py-12 text-center text-sm text-muted-foreground">PDF не загружен</div>
                )}
                <div
                  className="pointer-events-none absolute border-2 border-blue-500/80 bg-blue-500/10"
                  style={{
                    left: `${placement.x}px`,
                    top: `${placement.y}px`,
                    width: `${placement.width}px`,
                    height: `${placement.height}px`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Страница</label>
            <input
              type="number"
              min={1}
              max={Math.max(1, numPages)}
              value={pageNumber}
              onChange={(event) => {
                const value = Number(event.target.value || 1)
                setPageNumber(Math.max(1, Math.min(value, Math.max(1, numPages))))
              }}
              className="h-8 w-24 rounded-md border border-input px-2 text-sm"
            />
            <span className="text-xs text-muted-foreground">из {numPages || 1}</span>
          </div>
        </div>

        <div className="space-y-3">
          <SignaturePad onChange={setSignatureDataUrl} />

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              X
              <input
                type="number"
                value={placement.x}
                min={0}
                onChange={(event) => setPlacement((prev) => ({ ...prev, x: Math.max(0, Number(event.target.value || 0)) }))}
                className="mt-1 h-8 w-full rounded-md border border-input px-2 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Y
              <input
                type="number"
                value={placement.y}
                min={0}
                onChange={(event) => setPlacement((prev) => ({ ...prev, y: Math.max(0, Number(event.target.value || 0)) }))}
                className="mt-1 h-8 w-full rounded-md border border-input px-2 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Width
              <input
                type="number"
                value={placement.width}
                min={10}
                onChange={(event) =>
                  setPlacement((prev) => ({ ...prev, width: Math.max(10, Number(event.target.value || 10)) }))
                }
                className="mt-1 h-8 w-full rounded-md border border-input px-2 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Height
              <input
                type="number"
                value={placement.height}
                min={10}
                onChange={(event) =>
                  setPlacement((prev) => ({ ...prev, height: Math.max(10, Number(event.target.value || 10)) }))
                }
                className="mt-1 h-8 w-full rounded-md border border-input px-2 text-sm"
              />
            </label>
          </div>

          <Button className="w-full" onClick={saveSignature} disabled={saving || loadingPdf || file.status !== 'ready'}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Сохранить подпись
          </Button>
        </div>
      </div>
    </div>
  )
}
