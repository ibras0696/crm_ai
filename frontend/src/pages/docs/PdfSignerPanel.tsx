import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { X, Loader2, Upload } from 'lucide-react'
import { docsApi, type DocsFile } from '@/lib/api'

interface PdfSignerPanelProps {
    file: DocsFile
    onClose: () => void
    onError: (msg: string) => void
    onFileUpdated: (file: DocsFile) => void
    pollFileStatus: (fileIds: string[]) => Promise<void>
}

export function PdfSignerPanel({
    file,
    onClose,
    onError,
    pollFileStatus,
}: PdfSignerPanelProps) {
    const [loading, setLoading] = useState(false)
    const [base64Image, setBase64Image] = useState<string>('')

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (!f) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            setBase64Image(ev.target?.result as string)
        }
        reader.readAsDataURL(f)
    }

    const handleSign = async () => {
        if (!base64Image) {
            onError('Сначала загрузите изображение подписи')
            return
        }
        setLoading(true)
        try {
            const resp = await docsApi.signPdf(file.id, {
                page: 1,
                x: 50,
                y: 50,
                width: 150,
                height: 50,
                image: base64Image,
            })
            if (!resp.data.ok || !resp.data.data) {
                onError(resp.data.error?.message || 'Не удалось подписать PDF')
                setLoading(false)
                return
            }
            onClose()
            await pollFileStatus([file.id])
        } catch {
            onError('Ошибка при подписании PDF')
            setLoading(false)
        }
    }

    return (
        <div className="mt-6 border-t border-border pt-4">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-sm font-semibold">Подпись PDF: {file.title || file.original_name}</h3>
                    <p className="text-xs text-muted-foreground">Загрузите изображение подписи (PNG/JPG)</p>
                </div>
                <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
                    <X className="mr-1 h-4 w-4" /> Закрыть
                </Button>
            </div>

            <div className="space-y-4">
                <div>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="text-sm" />
                </div>
                {base64Image && (
                    <div className="max-w-[200px]">
                        <img src={base64Image} alt="Подпись" className="w-full h-auto border border-border rounded" />
                    </div>
                )}
                <Button onClick={handleSign} disabled={loading || !base64Image}>
                    {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                    Подписать (стр. 1, верх-лево)
                </Button>
            </div>
        </div>
    )
}
