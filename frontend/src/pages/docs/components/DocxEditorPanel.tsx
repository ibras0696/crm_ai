import { useEffect } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { DocumentEditor, type IConfig } from '@onlyoffice/document-editor-react'

import { Button } from '@/components/ui/button'
import { docsApi, type DocsFile } from '@/lib/api'

interface DocxEditorPanelProps {
  file: DocsFile
  documentServerUrl: string
  config: IConfig
  loading: boolean
  onClose: () => void
  onError: (message: string) => void
  onFileUpdated: (file: DocsFile) => void
}

export function DocxEditorPanel({
  file,
  documentServerUrl,
  config,
  loading,
  onClose,
  onError,
  onFileUpdated,
}: DocxEditorPanelProps) {
  useEffect(() => {
    const interval = window.setInterval(async () => {
      try {
        const response = await docsApi.getFile(file.id)
        if (response.data.ok && response.data.data) {
          onFileUpdated(response.data.data)
        }
      } catch {
        // silent polling fail
      }
    }, 4000)

    return () => {
      window.clearInterval(interval)
    }
  }, [file.id, onFileUpdated])

  return (
    <div className="mt-6 space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">DOCX редактор: {file.title || file.original_name}</h3>
          <p className="text-xs text-muted-foreground">
            Сохранение в OnlyOffice создаёт новую версию, затем запускается проверка файла.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const response = await docsApi.getFile(file.id)
                if (response.data.ok && response.data.data) {
                  onFileUpdated(response.data.data)
                }
              } catch {
                onError('Не удалось обновить статус DOCX')
              }
            }}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Обновить статус
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="mr-1 h-4 w-4" /> Закрыть
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-80 items-center justify-center rounded-md border border-dashed border-border">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <DocumentEditor
            id={`onlyoffice-${file.id}`}
            documentServerUrl={documentServerUrl}
            config={config}
            height="720px"
            width="100%"
            events_onError={() => onError('Ошибка редактора OnlyOffice')}
          />
        </div>
      )}
    </div>
  )
}

