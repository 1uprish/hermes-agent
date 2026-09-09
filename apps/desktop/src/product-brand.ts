export const IS_MACMAN_DISTRIBUTION = import.meta.env.VITE_MACMAN_DISTRIBUTION === '1'
export const PRODUCT_NAME = IS_MACMAN_DISTRIBUTION ? 'MacMan' : 'Hermes'
export const PRODUCT_WORDMARK = IS_MACMAN_DISTRIBUTION ? 'MACMAN' : 'HERMES AGENT'

export function productWordmark(enabled = IS_MACMAN_DISTRIBUTION): string {
  return enabled ? 'MACMAN' : 'HERMES AGENT'
}

/** Hide the legacy wake model until a real "hey macman" model is bundled. */
export function supportsLegacyWakeWord(enabled = IS_MACMAN_DISTRIBUTION): boolean {
  return !enabled
}

/**
 * Rebrand copy at the presentation boundary only. Lowercase runtime names,
 * protocol keys, paths, commands, package names and URLs deliberately remain
 * untouched because Donna still speaks to the Hermes-compatible runtime.
 */
export function brandVisibleText(value: string, enabled = IS_MACMAN_DISTRIBUTION): string {
  if (!enabled || !value.includes('Hermes')) {
    return value
  }

  return value
    .replace(/Hermes Desktop\b/g, 'MacMan')
    .replace(/Hermes Agent\b/g, 'MacMan runtime')
    .replace(/\bHermes\b/g, 'MacMan')
}

/** Rebrand a locale tree without changing its shape or mutating the source. */
export function brandVisibleTree<T>(value: T, enabled = IS_MACMAN_DISTRIBUTION): T {
  if (!enabled) {
    return value
  }

  if (typeof value === 'string') {
    return brandVisibleText(value, true) as T
  }

  if (typeof value === 'function') {
    const source = value as (...args: unknown[]) => unknown

    return ((...args: unknown[]) => {
      const result = source(...args)

      return typeof result === 'string' ? brandVisibleText(result, true) : result
    }) as T
  }

  if (Array.isArray(value)) {
    return value.map(item => brandVisibleTree(item, true)) as T
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, brandVisibleTree(item, true)])
    ) as T
  }

  return value
}
