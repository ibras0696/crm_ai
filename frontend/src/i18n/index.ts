import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getPreferredLocale } from '@/lib/i18n'
import { isI18nEnabled } from '@/lib/featureFlags'
import { reportMissingI18nKey } from '@/lib/i18nDiagnostics'
import { resources } from './resources'

const i18nEnabled = isI18nEnabled()

void i18n.use(initReactI18next).init({
  resources,
  lng: i18nEnabled ? getPreferredLocale() : 'ru',
  fallbackLng: 'ru',
  supportedLngs: i18nEnabled ? ['ru', 'en'] : ['ru'],
  ns: ['common', 'settings', 'auth', 'legal', 'chat', 'docs', 'knowledge'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
  saveMissing: true,
  missingKeyHandler: (lngs: readonly string[] | string, ns: string, key: string) => {
    reportMissingI18nKey(lngs, ns, key)
  },
  returnEmptyString: false,
  returnNull: false,
})

export default i18n
