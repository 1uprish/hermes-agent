import { brandVisibleTree, IS_MACMAN_DISTRIBUTION } from '../product-brand'

import { ar } from './ar'
import { en } from './en'
import { ja } from './ja'
import { ru } from './ru'
import type { Locale, Translations } from './types'
import { zh } from './zh'
import { zhHant } from './zh-hant'

const sourceTranslations: Record<Locale, Translations> = {
  en,
  zh,
  'zh-hant': zhHant,
  ja,
  ar,
  ru
}

export const TRANSLATIONS = brandVisibleTree(sourceTranslations, IS_MACMAN_DISTRIBUTION)
