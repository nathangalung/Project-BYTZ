import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import enAuth from '@/locales/en/auth.json'
import enChat from '@/locales/en/chat.json'
import enCommon from '@/locales/en/common.json'
import enDocument from '@/locales/en/document.json'
import enErrors from '@/locales/en/errors.json'
import enMatching from '@/locales/en/matching.json'
import enPayment from '@/locales/en/payment.json'
import enProject from '@/locales/en/project.json'
import enTalent from '@/locales/en/talent.json'
import idAuth from '@/locales/id/auth.json'
import idChat from '@/locales/id/chat.json'
import idCommon from '@/locales/id/common.json'
import idDocument from '@/locales/id/document.json'
import idErrors from '@/locales/id/errors.json'
import idMatching from '@/locales/id/matching.json'
import idPayment from '@/locales/id/payment.json'
import idProject from '@/locales/id/project.json'
import idTalent from '@/locales/id/talent.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'id',
    supportedLngs: ['id', 'en'],
    defaultNS: 'common',
    ns: [
      'common',
      'auth',
      'project',
      'talent',
      'chat',
      'document',
      'matching',
      'payment',
      'errors',
    ],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    resources: {
      id: {
        common: idCommon,
        auth: idAuth,
        project: idProject,
        talent: idTalent,
        chat: idChat,
        document: idDocument,
        matching: idMatching,
        payment: idPayment,
        errors: idErrors,
      },
      en: {
        common: enCommon,
        auth: enAuth,
        project: enProject,
        talent: enTalent,
        chat: enChat,
        document: enDocument,
        matching: enMatching,
        payment: enPayment,
        errors: enErrors,
      },
    },
  })

export default i18n
