import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi } from '@/lib/api/auth/auth'
import { Loader2, ArrowRight } from 'lucide-react'

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        if (!email || !email.includes('@')) {
            setError('Введите корректный email')
            return
        }
        setLoading(true)
        try {
            await authApi.forgotPassword({ email })
            setSuccess(true)
        } catch (err: any) {
            setError(err?.message || 'Не удалось отправить ссылку для сброса пароля.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center p-8">
            <div className="w-full max-w-sm space-y-8">
                <div>
                    <h2 className="text-2xl font-bold">Сброс пароля</h2>
                    <p className="text-muted-foreground mt-1">
                        Введите email, и мы отправим ссылку для сброса пароля.
                    </p>
                </div>

                {success ? (
                    <div className="space-y-5">
                        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-emerald-500">
                            Если аккаунт с таким email существует, мы отправили на него ссылку для восстановления.
                        </div>
                        <Link to="/login" className="block text-center text-primary font-medium hover:underline">
                            Вернуться ко входу
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {error && (
                            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-red-400">
                                {error}
                            </div>
                        )}
                        <div className="space-y-1">
                            <Label htmlFor="email">Эл. почта</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@company.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="h-11 bg-secondary/50"
                            />
                        </div>
                        <Button type="submit" className="w-full h-11 gradient-primary border-0 text-white font-semibold" disabled={loading}>
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <ArrowRight className="h-4 w-4 mr-2" />
                            )}
                            {loading ? 'Отправка...' : 'Сбросить пароль'}
                        </Button>

                        <div className="text-center text-sm text-muted-foreground mt-4">
                            Вспомнили пароль?{' '}
                            <Link to="/login" className="text-primary hover:underline font-medium">
                                Войти
                            </Link>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}
