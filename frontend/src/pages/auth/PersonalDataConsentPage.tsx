import { Link } from 'react-router-dom'

export default function PersonalDataConsentPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Согласие на обработку персональных данных</h1>
          <Link to="/landing" className="text-sm text-primary hover:underline">
            На главную
          </Link>
        </div>

        <div className="space-y-6 text-sm leading-6 text-muted-foreground">
          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">1. Предмет согласия</h2>
            <p>
              Пользователь подтверждает согласие на обработку персональных данных при создании и использовании аккаунта
              в CRM Platform.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">2. Перечень действий с данными</h2>
            <p>
              Сбор, запись, систематизация, хранение, уточнение, использование, передача в рамках функционала сервиса,
              блокирование, удаление и уничтожение персональных данных в пределах заявленных целей.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">3. Цели обработки</h2>
            <p>
              Обработка выполняется для регистрации пользователя, предоставления доступа к модулям платформы,
              администрирования организации, информационной безопасности и технической поддержки.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">4. Срок действия согласия</h2>
            <p>
              Согласие действует до момента его отзыва пользователем либо до прекращения правовых оснований обработки
              персональных данных.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">5. Отзыв согласия</h2>
            <p>
              Пользователь может отозвать согласие путем направления запроса администратору организации/оператору сервиса.
              Отзыв может повлечь ограничение или прекращение доступа к функционалу платформы.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
