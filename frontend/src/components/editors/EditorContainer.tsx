import { PDFViewer } from './pdf/PDFViewer'
import { SimpleWordEditor } from './docx/SimpleWordEditor'
import Editor from '@monaco-editor/react'
import type { DocsFile } from '@/lib/api'
import type { EditorType, PDFAnnotation } from '@/lib/types/editors'
import { selectEditor } from '@/lib/utils/editorSelector'

interface EditorContainerProps {
  file: DocsFile
  fileUrl: string
  onSave: (data: EditorSaveData) => Promise<void>
  onClose: () => void
  readOnly?: boolean
}

export interface EditorSaveData {
  type: 'pdf' | 'docx' | 'txt'
  pdfBytes?: Uint8Array
  pdfAnnotations?: PDFAnnotation[]
  docxBlob?: Blob
  htmlContent?: string
  textContent?: string
}

export function EditorContainer({
  file,
  fileUrl,
  onSave,
  onClose: _onClose,
  readOnly = false,
}: EditorContainerProps) {
  const editorType: EditorType = selectEditor(file)

  const handlePdfSave = async (pdfBytes: Uint8Array, annotations: PDFAnnotation[]) => {
    await onSave({
      type: 'pdf',
      pdfBytes,
      pdfAnnotations: annotations,
    })
  }

  const handleDocxSave = async (docxBlob: Blob, htmlContent: string) => {
    await onSave({
      type: 'docx',
      docxBlob,
      htmlContent,
    })
  }

  if (editorType === 'pdf') {
    return (
      <PDFViewer
        fileUrl={fileUrl}
        onSave={handlePdfSave}
        readOnly={readOnly}
      />
    )
  }

  if (editorType === 'docx') {
    return (
      <SimpleWordEditor
        fileUrl={fileUrl}
        onSave={handleDocxSave}
        readOnly={readOnly}
      />
    )
  }

  if (editorType === 'monaco' || editorType === 'txt') {
    return (
      <div className="flex h-full flex-col">
        <Editor
          height="100%"
          defaultLanguage="plaintext"
          defaultValue=""
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: 'on',
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            readOnly,
          }}
          onChange={(value) => {
            if (value !== undefined && !readOnly) {
              // Auto-save or manual save can be implemented here
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p>Unsupported file type: {file.type}</p>
    </div>
  )
}
