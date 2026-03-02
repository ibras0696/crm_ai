import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { orgApi } from '@/lib/api/org/org'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2, ArrowRight } from 'lucide-react'

export default function AcceptInvitePage() {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const { setToken } = useAuth()

    const token = searchParams.get('token')
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        if (!token) {
            setError('Недействительная ссылка. Убедитесь, что вы скопировали её целиком.')
            return
        }

        if (!firstName.trim()) {
            setError('Введите ваше имя')
            return
        }

        if (!password || password.length < 8) {
            setError('Пароль должен быть не менее 8 символов')
            return
        }

        setLoading(true)
        try {
            const resp = await orgApi.acceptInvite({
                token,
                password,
                first_name: firstName,
                last_name: lastName,
            })

            const data = resp.data.data as any
            if (data && data.access_token) {
                setToken(data.access_token, data.refresh_token)
                navigate('/dashboard')
            } else {
                setError('Не удалось получить токен авторизации после принятия приглашения.')
            }
        } catch (err: any) {
            setError(err?.message || 'Не удалось принять приглашение. Токен устарел или уже использован.')
        } finally {
            setLoading(false)
        }
    }

    if (!token) {
        return (
            <div className="flex min-h-screen items-center justify-center p-8">
                <div className="w-full max-w-sm space-y-4 text-center">
                    <p className="text-red-400">Отсутствует токен приглашения.</p>
                    <Link to="/login" className="text-primary hover:underline font-medium">
                        Вернуться ко входу
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="flex min-h-screen items-center justify-center p-8">
            <div className="w-full max-w-sm space-y-8">
                <div>
                    <h2 className="text-2xl font-bold">Принятие приглашения</h2>
                    <p className="text-muted-foreground mt-1">
                        Заполните данные для создания аккаунта.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    {error && (
                        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label htmlFor="firstName">Имя</Label>
                            <Input
                                id="firstName"
                                placeholder="Иван"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                className="h-11 bg-secondary/50"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="lastName">Фамилия (опц.)</Label>
                            <Input
                                id="lastName"
                                placeholder="Иванов"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                className="h-11 bg-secondary/50"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="password">Придумайте пароль</Label>
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
                        {loading ? 'Создание...' : 'Создать аккаунт и войти'}
                    </Button>
                </form>
            </div>
        </div>
    )
}
