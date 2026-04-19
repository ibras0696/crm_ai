import { Link } from 'react-router-dom'
import AuthLanguageSwitcher from '@/components/auth/AuthLanguageSwitcher'
import { useTranslation } from 'react-i18next'

export default function PrivacyPolicyPage() {
  const { t } = useTranslation('legal')

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t('privacy.title')}</h1>
          <div className="flex items-center gap-4">
            <AuthLanguageSwitcher />
            <Link to="/landing" className="text-sm text-primary hover:underline">
              {t('toLanding')}
            </Link>
          </div>
        </div>

        <div className="space-y-6 text-sm leading-6 text-muted-foreground">
          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">{t('privacy.s1Title')}</h2>
            <p>{t('privacy.s1Body')}</p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">{t('privacy.s2Title')}</h2>
            <p>{t('privacy.s2Body')}</p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">{t('privacy.s3Title')}</h2>
            <p>{t('privacy.s3Body')}</p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">{t('privacy.s4Title')}</h2>
            <p>{t('privacy.s4Body')}</p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">{t('privacy.s5Title')}</h2>
            <p>{t('privacy.s5Body')}</p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-foreground">{t('privacy.s6Title')}</h2>
            <p>{t('privacy.s6Body')}</p>
          </section>
        </div>
      </div>
    </div>
  )
}
