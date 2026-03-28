import { Button } from '@/components/ui/button'
import { FilePlus2, FileText, Loader2, Maximize2, Minimize2, X } from 'lucide-react'
import type { DocsFileType } from '@/lib/api'
import { DocxEditorPanel } from '../DocxEditorPanel'

export function DocsDialogs(props: Record<string, unknown>) {
  const {
    docxEditorFile,
    docxConfig,
    docxServerUrl,
    isEditorFullscreen,
    setIsEditorFullscreen,
    setDocxEditorFile,
    setDocxConfig,
    setDocxServerUrl,
    docxLoading,
    setErrorText,
    onFileUpdated,
    pendingDelete,
    setPendingDelete,
    deletingTargetId,
    confirmDelete,
    folderDialog,
    folderNameDraft,
    setFolderNameDraft,
    submitFolderDialog,
    closeFolderDialog,
    folderDialogSubmitting,
    fileDialog,
    folderMap,
    emptyType,
    setEmptyType,
    creatingEmpty,
    fileDialogSubmitting,
    emptyTitle,
    setEmptyTitle,
    createEmptyFile,
    closeFileDialog,
  } = props as any

  return (
    <>
        {docxEditorFile && docxConfig && docxServerUrl && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 lg:p-6 bg-background/50 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
            <div
              className={`flex flex-col bg-background shadow-2xl border border-border overflow-hidden transition-all duration-300 ${
                isEditorFullscreen
                  ? 'fixed inset-0 h-full w-full rounded-none border-0'
                  : 'h-[min(820px,calc(100vh-32px))] w-[min(1180px,calc(100vw-24px))] rounded-2xl'
              }`}
            >
              <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3 shadow-md flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100/80 text-blue-600 shadow-sm dark:bg-blue-900/40 dark:text-blue-400">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold leading-tight">{docxEditorFile.title || docxEditorFile.original_name}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5 font-medium flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      Редактор OnlyOffice
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditorFullscreen(!isEditorFullscreen)}
                    className="h-9 w-9 p-0 hover:bg-secondary"
                    title={isEditorFullscreen ? 'Свернуть окно' : 'Развернуть на весь экран'}
                  >
                    {isEditorFullscreen ? <Minimize2 className="h-4 w-4 opacity-70" /> : <Maximize2 className="h-4 w-4 opacity-70" />}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => {
                    setDocxEditorFile(null)
                    setDocxConfig(null)
                    setDocxServerUrl('')
                    setIsEditorFullscreen(false)
                  }} className="h-9 gap-2 shadow-sm border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all">
                    <X className="h-4 w-4" />
                    Закрыть редактор
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f4f4f4] dark:bg-neutral-900 shadow-inner pt-3">
                <DocxEditorPanel
                  file={docxEditorFile}
                  documentServerUrl={docxServerUrl}
                  config={docxConfig}
                  loading={docxLoading}
                  onError={setErrorText}
                  onFileUpdated={onFileUpdated}
                />
              </div>
            </div>
          </div>
        )}

        {pendingDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
              <div className="border-b border-border px-5 py-4">
                <h3 className="text-lg font-semibold">
                  {pendingDelete.kind === 'folder' ? 'Удалить папку' : 'Удалить файл'}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {pendingDelete.kind === 'folder'
                    ? `Папка «${pendingDelete.title}» будет удалена. Если внутри есть файлы или вложенные папки, backend не даст удалить её, пока вы не очистите содержимое.`
                    : `Файл «${pendingDelete.title}» будет удалён из документов. Это действие нельзя отменить.`}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4">
                <Button
                  variant="outline"
                  onClick={() => setPendingDelete(null)}
                  disabled={deletingTargetId === pendingDelete.id}
                >
                  Отмена
                </Button>
                <Button
                  onClick={() => void confirmDelete()}
                  disabled={deletingTargetId === pendingDelete.id}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deletingTargetId === pendingDelete.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Удаляем
                    </>
                  ) : (
                    'Удалить'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {folderDialog && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
              <div className="border-b border-border px-5 py-4">
                <h3 className="text-lg font-semibold">
                  {folderDialog.mode === 'create' ? 'Создать папку' : 'Переименовать папку'}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {folderDialog.mode === 'create'
                    ? 'Укажите название новой папки.'
                    : `Измените название папки «${folderDialog.initialName}».`}
                </p>
              </div>
              <div className="px-5 py-4">
                <input
                  autoFocus
                  value={folderNameDraft}
                  onChange={(event) => setFolderNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitFolderDialog()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      closeFolderDialog()
                    }
                  }}
                  disabled={folderDialogSubmitting}
                  placeholder="Название папки"
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4">
                <Button
                  variant="outline"
                  onClick={closeFolderDialog}
                  disabled={folderDialogSubmitting}
                >
                  Отмена
                </Button>
                <Button
                  onClick={() => void submitFolderDialog()}
                  disabled={folderDialogSubmitting}
                >
                  {folderDialogSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {folderDialog.mode === 'create' ? 'Создаём' : 'Сохраняем'}
                    </>
                  ) : (
                    folderDialog.mode === 'create' ? 'Создать' : 'Сохранить'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {fileDialog && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
              <div className="border-b border-border px-5 py-4">
                <h3 className="text-lg font-semibold">Создать файл</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {fileDialog.folderId
                    ? `Файл будет создан в папке «${folderMap.get(fileDialog.folderId)?.name ?? 'Без названия'}».`
                    : 'Файл будет создан в корне документов.'}
                </p>
              </div>
              <div className="space-y-3 px-5 py-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">Тип файла</label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={emptyType}
                    onChange={(event) => setEmptyType(event.target.value as DocsFileType)}
                    disabled={fileDialogSubmitting || creatingEmpty}
                  >
                    <option value="docx">DOCX</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">Название файла</label>
                  <input
                    autoFocus
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    placeholder="Например, Договор или КП"
                    value={emptyTitle}
                    onChange={(event) => setEmptyTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void createEmptyFile()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        closeFileDialog()
                      }
                    }}
                    maxLength={200}
                    disabled={fileDialogSubmitting || creatingEmpty}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4">
                <Button variant="outline" onClick={closeFileDialog} disabled={fileDialogSubmitting || creatingEmpty}>
                  Отмена
                </Button>
                <Button onClick={() => void createEmptyFile()} disabled={fileDialogSubmitting || creatingEmpty}>
                  {fileDialogSubmitting || creatingEmpty ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Создаём
                    </>
                  ) : (
                    <>
                      <FilePlus2 className="mr-2 h-4 w-4" />
                      Создать
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
    </>
  )
}
