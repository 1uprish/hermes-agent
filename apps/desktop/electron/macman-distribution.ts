import fs from 'node:fs'
import path from 'node:path'

export const MACMAN_BUNDLE_ID = 'com.macman.app'
export const MACMAN_CUA_DRIVER_VERSION = '0.22.1'
export const MACMAN_PRODUCT_NAME = 'MacMan'

export type MacManDistribution = {
  bundleId: typeof MACMAN_BUNDLE_ID
  cuaDriverVersion: typeof MACMAN_CUA_DRIVER_VERSION
  productName: typeof MACMAN_PRODUCT_NAME
  schemaVersion: 1
}

export function applicationNameForDistribution(
  distribution: MacManDistribution | null,
  sourcePackageName: string
): string {
  return distribution?.productName ?? sourcePackageName
}

export function userDataPathForDistribution(
  distribution: MacManDistribution | null,
  appDataPath: string
): string | null {
  return distribution ? path.join(appDataPath, distribution.productName) : null
}

export function readMacManDistribution(resourcesPath: string): MacManDistribution | null {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(resourcesPath, 'macman-distribution.json'), 'utf8'))

    if (
      marker?.schemaVersion !== 1 ||
      marker?.productName !== MACMAN_PRODUCT_NAME ||
      marker?.bundleId !== MACMAN_BUNDLE_ID ||
      marker?.cuaDriverVersion !== MACMAN_CUA_DRIVER_VERSION
    ) {
      return null
    }

    return marker as MacManDistribution
  } catch {
    return null
  }
}
