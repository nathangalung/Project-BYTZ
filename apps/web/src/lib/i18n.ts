import { formatNotificationCurrency } from '@kerjacus/shared'
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import enAuth from '@/locales/en/auth.json'
import enChat from '@/locales/en/chat.json'
import enCommon from '@/locales/en/common.json'
import enDocument from '@/locales/en/document.json'
import enErrors from '@/locales/en/errors.json'
import enMatching from '@/locales/en/matching.json'
import enNotification from '@/locales/en/notification.json'
import enPayment from '@/locales/en/payment.json'
import enProject from '@/locales/en/project.json'
import enTalent from '@/locales/en/talent.json'
import idAuth from '@/locales/id/auth.json'
import idChat from '@/locales/id/chat.json'
import idCommon from '@/locales/id/common.json'
import idDocument from '@/locales/id/document.json'
import idErrors from '@/locales/id/errors.json'
import idMatching from '@/locales/id/matching.json'
import idNotification from '@/locales/id/notification.json'
import idPayment from '@/locales/id/payment.json'
import idProject from '@/locales/id/project.json'
import idTalent from '@/locales/id/talent.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'id',
    supportedLngs: ['id', 'en'],
    // Collapse id-ID or en-GB from navigator to the base we ship.
    load: 'languageOnly',
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
      'notification',
    ],
    interpolation: {
      escapeValue: false,
      // Notification templates ask for Rupiah as {{amount, currency}}. The Go
      // renderer that writes the email body implements the same two forms, so a
      // template cannot ask for formatting only one side can do.
      format: (value, format) =>
        format === 'currency' ? formatNotificationCurrency(Number(value)) : String(value),
    },
    // Leave an unfilled placeholder standing rather than blanking it, matching
    // the Go renderer. A visible '{{amount}}' is a bug report; an empty gap is a
    // sentence that reads as finished and is wrong.
    missingInterpolationHandler: (_text, value) => (Array.isArray(value) ? value[0] : value),
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
        notification: idNotification,
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
        notification: enNotification,
      },
    },
  })

export default i18n
