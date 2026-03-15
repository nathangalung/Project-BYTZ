import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import adminEn from '@/locales/en/admin.json'
import adminId from '@/locales/id/admin.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'id',
    supportedLngs: ['id', 'en'],
    defaultNS: 'admin',
    ns: ['admin'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    resources: {
      id: { admin: adminId },
      en: { admin: adminEn },
    },
  })

export default i18n
