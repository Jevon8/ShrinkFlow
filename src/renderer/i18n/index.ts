import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'

// Language migration: ensure existing dev environments get zh as default
const LANG_MIGRATION_KEY = 'shrinkflow-lang-migrated-v2'
const savedLang = localStorage.getItem('shrinkflow-lang')
let lang: string

if (!localStorage.getItem(LANG_MIGRATION_KEY)) {
  // Migration not yet run: set zh for both old ('en' default) and new users
  lang = 'zh'
  localStorage.setItem('shrinkflow-lang', lang)
  localStorage.setItem(LANG_MIGRATION_KEY, '1')
} else {
  lang = savedLang || 'zh'
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh }
  },
  lng: lang,
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false
  }
})

// Sync main process menu language on startup
if (lang !== 'en') {
  window.api.setLanguage(lang)
}

export default i18n
