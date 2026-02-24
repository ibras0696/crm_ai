import { Link } from 'react-router-dom'

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Политика конфиденциальности</h1>
          <Link to="/landing" className="text-sm text-primary hover:underline">
            На главную
          </Link>
        </div>

        <div className="space-y-6 text-sm leading-6 text-muted-foreground">
          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">1. Общие положения</h2>
            <p>
              Настоящая политика описывает, как сервис CRM Platform обрабатывает персональные данные пользователей
              и представителей организаций при использовании веб-приложения.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">2. Какие данные обрабатываются</h2>
            <p>
              Мы обрабатываем регистрационные данные (email, имя, фамилия), данные профиля, данные действий в системе,
              а также данные, которые пользователь и организация добавляют в рабочие модули платформы.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">3. Цели обработки</h2>
            <p>
              Данные используются для предоставления доступа к сервису, работы функционала CRM, обеспечения безопасности,
              выполнения договорных обязательств и улучшения качества продукта.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">4. Хранение и защита</h2>
            <p>
              Данные хранятся на защищенной инфраструктуре с ограничением доступа и журналированием действий.
              Применяются технические и организационные меры для предотвращения несанкционированного доступа.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">5. Права пользователя</h2>
            <p>
              Пользователь вправе запросить уточнение, обновление или удаление своих персональных данных,
              а также отозвать ранее данное согласие в порядке, предусмотренном законодательством.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">6. Контакты</h2>
            <p>
              По вопросам обработки персональных данных обратитесь в поддержку вашей компании-оператора сервиса
              или администратору системы.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
