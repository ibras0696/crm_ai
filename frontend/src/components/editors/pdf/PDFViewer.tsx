import { useEffect, useState } from 'react'
import { Worker, Viewer, SpecialZoomLevel } from '@react-pdf-viewer/core'
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout'
import '@react-pdf-viewer/core/lib/styles/index.css'
import '@react-pdf-viewer/default-layout/lib/styles/index.css'
import { PDFDocument } from 'pdf-lib'
import type { PDFAnnotation } from '@/lib/types/editors'
import { Button } from '@/components/ui/button'
import { FileText, Loader2, Save } from 'lucide-react'

interface PDFViewerProps {
  fileUrl: string
  onSave: (pdfBytes: Uint8Array, annotations: PDFAnnotation[]) => Promise<void>
  initialAnnotations?: PDFAnnotation[]
  readOnly?: boolean
}

const WORKER_URL = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js'

export function PDFViewer({ fileUrl, onSave, initialAnnotations = [], readOnly = false }: PDFViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocument | null>(null)
  const [annotations] = useState<PDFAnnotation[]>(initialAnnotations)
  const [isSaving, setIsSaving] = useState(false)

  const defaultLayoutPluginInstance = defaultLayoutPlugin()

  useEffect(() => {
    let cancelled = false

    const loadPdf = async () => {
      try {
        const response = await fetch(fileUrl)
        const arrayBuffer = await response.arrayBuffer()
        const doc = await PDFDocument.load(arrayBuffer)
        if (!cancelled) setPdfDoc(doc)
      } catch (error) {
        console.error('Failed to load PDF:', error)
      }
    }

    void loadPdf()
    return () => {
      cancelled = true
    }
  }, [fileUrl])

  const savePDF = async () => {
    if (!pdfDoc) return
    setIsSaving(true)
    try {
      const pdfBytes = await pdfDoc.save()
      await onSave(pdfBytes, annotations)
    } catch (error) {
      console.error('Failed to save PDF:', error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {!readOnly && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-background p-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span>PDF просмотр и сохранение</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={savePDF}
            disabled={isSaving || !pdfDoc}
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {isSaving ? 'Сохранение...' : 'Сохранить PDF'}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <Worker workerUrl={WORKER_URL}>
          <Viewer
            fileUrl={fileUrl}
            plugins={[defaultLayoutPluginInstance]}
            defaultScale={SpecialZoomLevel.PageFit}
          />
        </Worker>
      </div>
    </div>
  )
}
