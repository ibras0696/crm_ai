import { X } from 'lucide-react'

export function MediaPreviewOverlay(props: Record<string, unknown>) {
  const { mediaPreview, setMediaPreview } = props as any

  if (!mediaPreview) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4"
      onClick={() => setMediaPreview(null)}
    >
      <div
        className="relative w-full max-w-6xl rounded-xl border border-white/20 bg-black/40 p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          onClick={() => setMediaPreview(null)}
          aria-label="Закрыть просмотр"
        >
          <X className="h-5 w-5" />
        </button>
        {mediaPreview.kind === 'image' ? (
          <img
            src={mediaPreview.url}
            alt={mediaPreview.originalName}
            decoding="async"
            className="mx-auto max-h-[82vh] max-w-full rounded-lg object-contain"
          />
        ) : (
          <video
            src={mediaPreview.url}
            controls
            autoPlay
            preload="metadata"
            className="mx-auto max-h-[82vh] max-w-full rounded-lg"
          >
            Ваш браузер не поддерживает видео.
          </video>
        )}
      </div>
    </div>
  )
}
