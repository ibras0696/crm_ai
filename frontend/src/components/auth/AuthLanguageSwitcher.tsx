import { useTranslation } from 'react-i18next'
import { persistLocale, type AppLocale } from '@/lib/i18n'
import { isI18nEnabled } from '@/lib/featureFlags'

export default function AuthLanguageSwitcher() {
  const { t, i18n } = useTranslation(['auth', 'common'])
  if (!isI18nEnabled()) return null
  const current = i18n.resolvedLanguage === 'en' ? 'en' : 'ru'

  const setLanguage = (locale: AppLocale) => {
    void i18n.changeLanguage(locale)
    persistLocale(locale)
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/20 px-2 py-1">
      <span className="text-[11px] font-medium text-muted-foreground">{t('auth:switch.label')}:</span>
      <button
        type="button"
        onClick={() => setLanguage('ru')}
        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          current === 'ru' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {t('common:language.russian')}
      </button>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          current === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {t('common:language.english')}
      </button>
    </div>
  )
}
