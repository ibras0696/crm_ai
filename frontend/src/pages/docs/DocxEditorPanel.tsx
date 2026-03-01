import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { X, Loader2 } from 'lucide-react'
import type { DocsFile } from '@/lib/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OnlyOfficeConfig = any

interface DocxEditorPanelProps {
  file: DocsFile
  documentServerUrl: string
  config: OnlyOfficeConfig
  loading: boolean
  onClose: () => void
  onError: (msg: string) => void
  onFileUpdated: (file: DocsFile) => void
}

export function DocxEditorPanel({
  file,
  documentServerUrl,
  config,
  loading,
  onClose,
  onError,
}: DocxEditorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [scriptFailed, setScriptFailed] = useState(false)

  useEffect(() => {
    const scriptSrc = `${documentServerUrl}/web-apps/apps/api/documents/api.js`
    let script = document.querySelector(`script[src="${scriptSrc}"]`) as HTMLScriptElement

    const handleLoad = () => setScriptLoaded(true)
    const handleError = () => {
      setScriptFailed(true)
      onError('Не удалось загрузить API редактора OnlyOffice. Проверьте соединение.')
    }

    if (!script) {
      script = document.createElement('script')
      script.src = scriptSrc
      script.async = true
      script.onload = handleLoad
      script.onerror = handleError
      document.body.appendChild(script)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).DocsAPI) {
        setScriptLoaded(true)
      } else {
        script.addEventListener('load', handleLoad)
        script.addEventListener('error', handleError)
      }
    }

    return () => {
      if (script) {
        script.removeEventListener('load', handleLoad)
        script.removeEventListener('error', handleError)
      }
    }
  }, [documentServerUrl, onError])

  useEffect(() => {
    if (!scriptLoaded || scriptFailed || !containerRef.current) return

    const editorId = `onlyoffice-editor-${file.id}`
    containerRef.current.id = editorId
    containerRef.current.innerHTML = '' // clear previous

    let docEditor: any = null
    let retries = 0
    let initInterval: ReturnType<typeof setInterval>

    const initDocs = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const DocsAPI = (window as any).DocsAPI
      if (!DocsAPI) {
        if (retries > 50) { // 5 секунд ожидания
          onError('API редактора отсутствует. Превышено время ожидания.')
          clearInterval(initInterval)
        }
        retries++
        return
      }

      clearInterval(initInterval)
      try {
        docEditor = new DocsAPI.DocEditor(editorId, config)
      } catch (err) {
        onError('Ошибка инициализации редактора')
      }
    }

    initInterval = setInterval(initDocs, 100)
    initDocs() // первый синхронный вызов

    return () => {
      clearInterval(initInterval)
      if (docEditor && docEditor.destroyEditor) {
        docEditor.destroyEditor()
      }
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [scriptLoaded, scriptFailed, file.id, config, onError])

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">Редактор DOCX: {file.title || file.original_name}</h3>
          <p className="text-xs text-muted-foreground">Сохранение происходит автоматически</p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          <X className="mr-1 h-4 w-4" /> Закрыть
        </Button>
      </div>

      {(loading || !scriptLoaded) && !scriptFailed ? (
        <div className="flex h-[600px] w-full items-center justify-center rounded-md border border-dashed border-border">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="h-[600px] w-full rounded-md border border-input overflow-hidden">
          <div ref={containerRef} className="h-full w-full" />
        </div>
      )}
    </div>
  )
}
