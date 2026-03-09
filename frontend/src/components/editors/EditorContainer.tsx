import { SimpleWordEditor } from './docx/SimpleWordEditor'
import Editor from '@monaco-editor/react'
import { Button } from '@/components/ui/button'
import type { DocsFile } from '@/lib/api'
import type { EditorType } from '@/lib/types/editors'
import { selectEditor } from '@/lib/utils/editorSelector'
import { Download, ExternalLink, FileText } from 'lucide-react'

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
  pdfAnnotations?: unknown[]
  docxBlob?: Blob
  htmlContent?: string
  textContent?: string
}

export function EditorContainer({
  file,
  fileUrl,
  onSave,
  onClose,
  readOnly = false,
}: EditorContainerProps) {
  void onClose
  const editorType: EditorType = selectEditor(file)

  const handleDocxSave = async (docxBlob: Blob, htmlContent: string) => {
    await onSave({
      type: 'docx',
      docxBlob,
      htmlContent,
    })
  }

  if (editorType === 'pdf') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-xl bg-secondary p-3">
              <FileText className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">PDF доступен без редактора</h3>
              <p className="text-sm text-muted-foreground">
                Для PDF в приложении оставлены загрузка, скачивание и хранение. Полноценный редактор PDF отключён.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={fileUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Открыть в браузере
              </a>
            </Button>
            <Button asChild>
              <a href={fileUrl} download={file.original_name || file.title || 'document.pdf'}>
                <Download className="mr-2 h-4 w-4" />
                Скачать PDF
              </a>
            </Button>
          </div>
        </div>
      </div>
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
