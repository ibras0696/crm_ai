import { useEffect, useRef, useState } from 'react'
import { Worker, Viewer, SpecialZoomLevel } from '@react-pdf-viewer/core'
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout'
import type { ToolbarSlot, TransformToolbarSlot } from '@react-pdf-viewer/toolbar'
import '@react-pdf-viewer/core/lib/styles/index.css'
import '@react-pdf-viewer/default-layout/lib/styles/index.css'
import { PDFDocument } from 'pdf-lib'
import { fabric } from 'fabric'
import type { PDFAnnotation, PDFTool, Coords } from '@/lib/types/editors'
import { Button } from '@/components/ui/button'
import { 
  Type, 
  Highlighter, 
  Square, 
  Circle, 
  ArrowRight, 
  PenLine, 
  Stamp,
  MessageSquare,
  MousePointer,
  Download,
  Save,
  Undo,
  Redo,
  ZoomIn,
  ZoomOut
} from 'lucide-react'

interface PDFViewerProps {
  fileUrl: string
  onSave: (pdfBytes: Uint8Array, annotations: PDFAnnotation[]) => Promise<void>
  initialAnnotations?: PDFAnnotation[]
  readOnly?: boolean
}

const WORKER_URL = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js'

export function PDFViewer({ fileUrl, onSave, initialAnnotations = [], readOnly = false }: PDFViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocument | null>(null)
  const [annotations, setAnnotations] = useState<PDFAnnotation[]>(initialAnnotations)
  const [selectedTool, setSelectedTool] = useState<PDFTool>('select')
  const [currentPage, setCurrentPage] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [isSaving, setIsSaving] = useState(false)
  const [canvasMap, setCanvasMap] = useState<Map<number, fabric.Canvas>>(new Map())
  const canvasContainerRef = useRef<HTMLDivElement>(null)

  const defaultLayoutPluginInstance = defaultLayoutPlugin({
    sidebarTabs: (defaultTabs) => [defaultTabs[0]], // Only thumbnails
    renderToolbar: (Toolbar: (props: ToolbarSlot) => React.ReactElement) => (
      <Toolbar>
        {(slots: ToolbarSlot) => {
          const { CurrentPageInput, NumberOfPages, ZoomIn, ZoomOut, Zoom } = slots
          return (
            <div className="flex items-center gap-2 px-2">
              <div className="flex items-center gap-1">
                <CurrentPageInput />
                <span className="text-sm">/ <NumberOfPages /></span>
              </div>
              <div className="h-6 w-px bg-border" />
              <ZoomOut />
              <Zoom />
              <ZoomIn />
            </div>
          )
        }}
      </Toolbar>
    ),
  })

  useEffect(() => {
    loadPDF()
  }, [fileUrl])

  const loadPDF = async () => {
    try {
      const response = await fetch(fileUrl)
      const arrayBuffer = await response.arrayBuffer()
      const doc = await PDFDocument.load(arrayBuffer)
      setPdfDoc(doc)
    } catch (error) {
      console.error('Failed to load PDF:', error)
    }
  }

  const initializeCanvas = (pageIndex: number, element: HTMLElement) => {
    if (canvasMap.has(pageIndex)) return

    const canvas = new fabric.Canvas(element, {
      isDrawingMode: false,
      selection: selectedTool === 'select',
    })

    canvas.on('mouse:down', (event) => handleCanvasMouseDown(event, pageIndex, canvas))
    canvas.on('mouse:move', (event) => handleCanvasMouseMove(event, pageIndex, canvas))
    canvas.on('mouse:up', (event) => handleCanvasMouseUp(event, pageIndex, canvas))

    setCanvasMap(prev => new Map(prev).set(pageIndex, canvas))
  }

  const handleCanvasMouseDown = (event: fabric.IEvent, pageIndex: number, canvas: fabric.Canvas) => {
    if (readOnly || selectedTool === 'select') return

    const pointer = canvas.getPointer(event.e)
    
    // Start drawing based on selected tool
    // Implementation will be added in next iteration
  }

  const handleCanvasMouseMove = (event: fabric.IEvent, pageIndex: number, canvas: fabric.Canvas) => {
    // Handle drawing while mouse moves
  }

  const handleCanvasMouseUp = (event: fabric.IEvent, pageIndex: number, canvas: fabric.Canvas) => {
    // Finalize drawing and create annotation
  }

  const addTextAnnotation = async (text: string, page: number, coords: Coords) => {
    const annotation: PDFAnnotation = {
      id: crypto.randomUUID(),
      type: 'text',
      page,
      coords,
      content: text,
      createdAt: new Date().toISOString(),
    }
    setAnnotations(prev => [...prev, annotation])
  }

  const addSignature = async (imageData: string, page: number, coords: Coords) => {
    const annotation: PDFAnnotation = {
      id: crypto.randomUUID(),
      type: 'signature',
      page,
      coords,
      imageData,
      createdAt: new Date().toISOString(),
    }
    setAnnotations(prev => [...prev, annotation])
  }

  const savePDF = async () => {
    if (!pdfDoc) return

    setIsSaving(true)
    try {
      // Apply all annotations to PDF
      for (const annotation of annotations) {
        const pages = pdfDoc.getPages()
        const page = pages[annotation.page]

        if (annotation.type === 'text' && annotation.content) {
          page.drawText(annotation.content, {
            x: annotation.coords.x,
            y: annotation.coords.y,
            size: 12,
          })
        }

        if (annotation.type === 'signature' && annotation.imageData) {
          const pngImage = await pdfDoc.embedPng(annotation.imageData)
          page.drawImage(pngImage, {
            x: annotation.coords.x,
            y: annotation.coords.y,
            width: annotation.coords.width,
            height: annotation.coords.height,
          })
        }

        // Add other annotation types
      }

      const pdfBytes = await pdfDoc.save()
      await onSave(pdfBytes, annotations)
    } catch (error) {
      console.error('Failed to save PDF:', error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const tools: Array<{ tool: PDFTool; icon: typeof Type; label: string }> = [
    { tool: 'select', icon: MousePointer, label: 'Select' },
    { tool: 'text', icon: Type, label: 'Text' },
    { tool: 'highlight', icon: Highlighter, label: 'Highlight' },
    { tool: 'rectangle', icon: Square, label: 'Rectangle' },
    { tool: 'circle', icon: Circle, label: 'Circle' },
    { tool: 'arrow', icon: ArrowRight, label: 'Arrow' },
    { tool: 'signature', icon: PenLine, label: 'Signature' },
    { tool: 'stamp', icon: Stamp, label: 'Stamp' },
    { tool: 'comment', icon: MessageSquare, label: 'Comment' },
  ]

  return (
    <div className="flex h-full flex-col">
      {!readOnly && (
        <div className="flex items-center gap-2 border-b border-border bg-background p-2">
          <div className="flex items-center gap-1 rounded-md border border-border p-1">
            {tools.map(({ tool, icon: Icon, label }) => (
              <Button
                key={tool}
                variant={selectedTool === tool ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedTool(tool)}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </Button>
            ))}
          </div>

          <div className="h-6 w-px bg-border" />

          <Button variant="ghost" size="sm" title="Undo">
            <Undo className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" title="Redo">
            <Redo className="h-4 w-4" />
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={savePDF}
              disabled={isSaving || annotations.length === 0}
            >
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save PDF'}
            </Button>
          </div>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <Worker workerUrl={WORKER_URL}>
          <Viewer
            fileUrl={fileUrl}
            plugins={[defaultLayoutPluginInstance]}
            defaultScale={SpecialZoomLevel.PageFit}
          />
        </Worker>

        {/* Canvas overlay for annotations */}
        <div
          ref={canvasContainerRef}
          className="pointer-events-none absolute inset-0"
          style={{ zIndex: 10 }}
        />
      </div>
    </div>
  )
}
