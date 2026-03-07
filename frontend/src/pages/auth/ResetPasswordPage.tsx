import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi } from '@/lib/api/auth/auth'
import { Loader2, ArrowRight } from 'lucide-react'

export default function ResetPasswordPage() {
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        if (!token) {
            setError('Недействительная ссылка. Убедитесь, что вы скопировали её целиком.')
            return
        }

        if (!password || password.length < 8) {
            setError('Пароль должен быть не менее 8 символов')
            return
        }

        setLoading(true)
        try {
            await authApi.resetPassword({ token, new_password: password })
            setSuccess(true)
        } catch (err: any) {
            setError(err?.message || 'Не удалось изменить пароль. Токен устарел или недействителен.')
        } finally {
            setLoading(false)
        }
    }

    if (!token) {
        return (
            <div className="flex min-h-screen items-center justify-center p-8">
                <div className="w-full max-w-sm space-y-4 text-center">
                    <p className="text-red-400">Отсутствует токен сброса пароля.</p>
                    <Link to="/auth/forgot-password" className="text-primary hover:underline font-medium">
                        Запросить новую ссылку
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="flex min-h-screen items-center justify-center p-8">
            <div className="w-full max-w-sm space-y-8">
                <div>
                    <h2 className="text-2xl font-bold">Установка пароля</h2>
                    <p className="text-muted-foreground mt-1">
                        Введите новый пароль для вашего аккаунта.
                    </p>
                </div>

                {success ? (
                    <div className="space-y-5 text-center">
                        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-emerald-500">
                            Ваш пароль успешно изменен!
                        </div>
                        <Link to="/login" className="block text-primary font-medium hover:underline">
                            Перейти ко входу
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
                            <Label htmlFor="password">Новый пароль</Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="Минимум 8 символов"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="h-11 bg-secondary/50"
                            />
                        </div>
                        <Button type="submit" className="w-full h-11 gradient-primary border-0 text-white font-semibold" disabled={loading}>
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <ArrowRight className="h-4 w-4 mr-2" />
                            )}
                            {loading ? 'Установка...' : 'Установить пароль'}
                        </Button>
                    </form>
                )}
            </div>
        </div>
    )
}
