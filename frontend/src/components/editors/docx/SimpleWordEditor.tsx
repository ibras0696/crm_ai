import { useState, useEffect } from 'react'
import { CKEditor } from '@ckeditor/ckeditor5-react'
import ClassicEditor from '@ckeditor/ckeditor5-build-classic'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import mammoth from 'mammoth'
import { Button } from '@/components/ui/button'
import { Save, Download, FileText, Loader2 } from 'lucide-react'

interface SimpleWordEditorProps {
  fileUrl?: string
  initialContent?: string
  onSave: (docxBlob: Blob, htmlContent: string) => Promise<void>
  readOnly?: boolean
}

export function SimpleWordEditor({ 
  fileUrl, 
  initialContent = '', 
  onSave, 
  readOnly = false 
}: SimpleWordEditorProps) {
  const [content, setContent] = useState(initialContent)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [characterCount, setCharacterCount] = useState(0)

  useEffect(() => {
    if (fileUrl) {
      loadDocx()
    }
  }, [fileUrl])

  useEffect(() => {
    updateStats(content)
  }, [content])

  const loadDocx = async () => {
    if (!fileUrl) return

    setIsLoading(true)
    try {
      const response = await fetch(fileUrl)
      const arrayBuffer = await response.arrayBuffer()
      
      const result = await mammoth.convertToHtml({ arrayBuffer })
      setContent(result.value)
    } catch (error) {
      console.error('Failed to load DOCX:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const updateStats = (html: string) => {
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const words = text.split(/\s+/).filter(w => w.length > 0)
    setWordCount(words.length)
    setCharacterCount(text.length)
  }

  const parseHTMLToDocx = (html: string): Paragraph[] => {
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
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element
        const children: TextRun[] = []

        element.childNodes.forEach(child => {
          children.push(...processNode(child))
        })

        if (children.length > 0) {
          const tagName = element.tagName.toLowerCase()
          
          if (tagName === 'strong' || tagName === 'b') {
            runs.push(new TextRun({ text: element.textContent || '', bold: true }))
          } else if (tagName === 'em' || tagName === 'i') {
            runs.push(new TextRun({ text: element.textContent || '', italics: true }))
          } else if (tagName === 'u') {
            runs.push(new TextRun({ text: element.textContent || '', underline: {} }))
          } else {
            runs.push(...children)
          }
        }
      }

      return runs
    }

    doc.body.childNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element
        const tagName = element.tagName.toLowerCase()
        const runs = processNode(node)

        if (runs.length === 0 && element.textContent?.trim()) {
          runs.push(new TextRun(element.textContent))
        }

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
        }

        paragraphs.push(new Paragraph({
          children: runs.length > 0 ? runs : [new TextRun(element.textContent || '')],
          heading,
        }))
      }
    })

    return paragraphs
  }

  const exportToDocx = async () => {
    setIsSaving(true)
    try {
      const paragraphs = parseHTMLToDocx(content)

      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs,
        }],
      })

      const blob = await Packer.toBlob(doc)
      await onSave(blob, content)
    } catch (error) {
      console.error('Failed to export DOCX:', error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const downloadDocx = async () => {
    const paragraphs = parseHTMLToDocx(content)
    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs,
      }],
    })

    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'document.docx'
    a.click()
    URL.revokeObjectURL(url)
  }

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
        <div className="flex items-center justify-between border-b border-border bg-background p-2">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-4 w-4" />
              {wordCount} words
            </span>
            <span>{characterCount} characters</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={downloadDocx}
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
            <Button
              size="sm"
              onClick={exportToDocx}
              disabled={isSaving}
            >
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        <CKEditor
          editor={ClassicEditor as any}
          data={content}
          disabled={readOnly}
          onChange={(_event, editor) => {
            const data = editor.getData()
            setContent(data)
          }}
          config={{
            toolbar: {
              items: [
                'heading',
                '|',
                'bold',
                'italic',
                'underline',
                'strikethrough',
                '|',
                'fontSize',
                'fontColor',
                'fontBackgroundColor',
                '|',
                'bulletedList',
                'numberedList',
                '|',
                'alignment',
                '|',
                'link',
                'insertTable',
                'blockQuote',
                '|',
                'undo',
                'redo',
              ],
            },
            heading: {
              options: [
                { model: 'paragraph', title: 'Paragraph', class: 'ck-heading_paragraph' },
                { model: 'heading1', view: 'h1', title: 'Heading 1', class: 'ck-heading_heading1' },
                { model: 'heading2', view: 'h2', title: 'Heading 2', class: 'ck-heading_heading2' },
                { model: 'heading3', view: 'h3', title: 'Heading 3', class: 'ck-heading_heading3' },
              ],
            },
            table: {
              contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'],
            },
          }}
        />
      </div>
    </div>
  )
}
