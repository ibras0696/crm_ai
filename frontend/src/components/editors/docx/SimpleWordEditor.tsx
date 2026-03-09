import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import mammoth from 'mammoth'
import {
  Bold,
  Download,
  FileText,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  Save,
  Underline,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SimpleWordEditorProps {
  fileUrl?: string
  initialContent?: string
  onSave: (docxBlob: Blob, htmlContent: string) => Promise<void>
  readOnly?: boolean
}

type ToolbarAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'insertUnorderedList'
  | 'insertOrderedList'
  | 'undo'
  | 'redo'

const TOOLBAR_BUTTONS: Array<{
  action: ToolbarAction | 'h1' | 'h2' | 'blockquote'
  icon: typeof Bold
  label: string
}> = [
  { action: 'bold', icon: Bold, label: 'Жирный' },
  { action: 'italic', icon: Italic, label: 'Курсив' },
  { action: 'underline', icon: Underline, label: 'Подчеркнутый' },
  { action: 'h1', icon: Heading1, label: 'Заголовок 1' },
  { action: 'h2', icon: Heading2, label: 'Заголовок 2' },
  { action: 'insertUnorderedList', icon: List, label: 'Маркированный список' },
  { action: 'insertOrderedList', icon: ListOrdered, label: 'Нумерованный список' },
  { action: 'blockquote', icon: Quote, label: 'Цитата' },
  { action: 'undo', icon: Undo2, label: 'Отменить' },
  { action: 'redo', icon: Redo2, label: 'Повторить' },
]

function normalizeHtml(html: string): string {
  const trimmed = html.trim()
  if (!trimmed) {
    return '<p></p>'
  }
  return trimmed
}

export function SimpleWordEditor({
  fileUrl,
  initialContent = '',
  onSave,
  readOnly = false,
}: SimpleWordEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [content, setContent] = useState(normalizeHtml(initialContent))
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [characterCount, setCharacterCount] = useState(0)

  const loadDocx = useCallback(async () => {
    if (!fileUrl) return

    setIsLoading(true)
    try {
      const response = await fetch(fileUrl)
      const arrayBuffer = await response.arrayBuffer()
      const result = await mammoth.convertToHtml({ arrayBuffer })
      setContent(normalizeHtml(result.value))
    } catch (error) {
      console.error('Failed to load DOCX:', error)
    } finally {
      setIsLoading(false)
    }
  }, [fileUrl])

  useEffect(() => {
    if (fileUrl) {
      void loadDocx()
    }
  }, [fileUrl, loadDocx])

  useEffect(() => {
    const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const words = text ? text.split(/\s+/).filter(Boolean) : []
    setWordCount(words.length)
    setCharacterCount(text.length)
  }, [content])

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== content) {
      editorRef.current.innerHTML = content
    }
  }, [content])

  const parseHTMLToDocx = useCallback((html: string): Paragraph[] => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const paragraphs: Paragraph[] = []

    const processNode = (node: Node): TextRun[] => {
      const runs: TextRun[] = []

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || ''
        if (text.trim()) {
          runs.push(new TextRun(text))
        }
        return runs
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return runs
      }

      const element = node as Element
      const children: TextRun[] = []
      element.childNodes.forEach((child) => {
        children.push(...processNode(child))
      })

      if (!children.length && element.textContent?.trim()) {
        children.push(new TextRun(element.textContent))
      }

      const tagName = element.tagName.toLowerCase()
      if (tagName === 'strong' || tagName === 'b') {
        return [new TextRun({ text: element.textContent || '', bold: true })]
      }
      if (tagName === 'em' || tagName === 'i') {
        return [new TextRun({ text: element.textContent || '', italics: true })]
      }
      if (tagName === 'u') {
        return [new TextRun({ text: element.textContent || '', underline: {} })]
      }
      return children
    }

    doc.body.childNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const element = node as Element
      const tagName = element.tagName.toLowerCase()
      const runs = processNode(node)

      let heading
      switch (tagName) {
        case 'h1':
          heading = HeadingLevel.HEADING_1
          break
        case 'h2':
          heading = HeadingLevel.HEADING_2
          break
        case 'h3':
          heading = HeadingLevel.HEADING_3
          break
        case 'h4':
          heading = HeadingLevel.HEADING_4
          break
        case 'h5':
          heading = HeadingLevel.HEADING_5
          break
        case 'h6':
          heading = HeadingLevel.HEADING_6
          break
        default:
          heading = undefined
      }

      paragraphs.push(
        new Paragraph({
          children: runs.length ? runs : [new TextRun(element.textContent || '')],
          heading,
        }),
      )
    })

    return paragraphs
  }, [])

  const exportToDocx = useCallback(async () => {
    setIsSaving(true)
    try {
      const paragraphs = parseHTMLToDocx(content)
      const doc = new Document({
        sections: [{ properties: {}, children: paragraphs }],
      })
      const blob = await Packer.toBlob(doc)
      await onSave(blob, content)
    } catch (error) {
      console.error('Failed to export DOCX:', error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [content, onSave, parseHTMLToDocx])

  const downloadDocx = useCallback(async () => {
    const paragraphs = parseHTMLToDocx(content)
    const doc = new Document({
      sections: [{ properties: {}, children: paragraphs }],
    })
    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'document.docx'
    a.click()
    URL.revokeObjectURL(url)
  }, [content, parseHTMLToDocx])

  const applyFormat = useCallback((action: ToolbarAction | 'h1' | 'h2' | 'blockquote') => {
    if (readOnly) return
    editorRef.current?.focus()

    if (action === 'h1') {
      document.execCommand('formatBlock', false, 'h1')
    } else if (action === 'h2') {
      document.execCommand('formatBlock', false, 'h2')
    } else if (action === 'blockquote') {
      document.execCommand('formatBlock', false, 'blockquote')
    } else {
      document.execCommand(action, false)
    }

    const nextHtml = normalizeHtml(editorRef.current?.innerHTML || '')
    setContent(nextHtml)
  }, [readOnly])

  const toolbar = useMemo(
    () =>
      TOOLBAR_BUTTONS.map(({ action, icon: Icon, label }) => (
        <Button
          key={action}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyFormat(action)}
          title={label}
          aria-label={label}
        >
          <Icon className="h-4 w-4" />
        </Button>
      )),
    [applyFormat],
  )

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background p-3">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-4 w-4" />
              {wordCount} words
            </span>
            <span>{characterCount} characters</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {toolbar}
            <Button type="button" variant="outline" size="sm" onClick={downloadDocx}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
            <Button type="button" size="sm" onClick={exportToDocx} disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-muted/20 p-4">
        <div className="mx-auto min-h-full max-w-4xl rounded-xl border border-border bg-background shadow-sm">
          <div
            ref={editorRef}
            className="min-h-[70vh] p-6 outline-none prose prose-sm max-w-none dark:prose-invert"
            contentEditable={!readOnly}
            suppressContentEditableWarning
            onInput={(event) => {
              const nextHtml = normalizeHtml((event.currentTarget as HTMLDivElement).innerHTML)
              setContent(nextHtml)
            }}
          />
        </div>
      </div>
    </div>
  )
}
