/**
 * Gateway access for the dedicated wizard window.
 *
 * The provider step reuses the classic onboarding store, whose flows need a
 * live JSON-RPC socket for exactly three calls (`reload.env`, `setup.status`,
 * `setup.runtime_check`) — everything else rides the preload REST bridge,
 * which every window has. Rather than importing the main renderer's whole
 * gateway registry, the wizard dials one lazy socket of its own: minted on
 * the first request, re-dialed if it drops, closed with the window.
 */

import { resolveGatewayWsUrl } from '@hermes/shared'

import { HermesGateway } from '@/hermes'
import type { OnboardingContext } from '@/store/onboarding'

let gateway: HermesGateway | null = null
let dialing: Promise<HermesGateway> | null = null

async function dial(): Promise<HermesGateway> {
  const desktop = window.hermesDesktop

  if (!desktop?.getConnection) {
    throw new Error('Hermes desktop bridge unavailable')
  }

  const wsUrl = await resolveGatewayWsUrl(desktop, await desktop.getConnection())
  const next = new HermesGateway()

  await next.connect(wsUrl)

  return next
}

async function ensureGateway(): Promise<HermesGateway> {
  if (gateway && gateway.connectionState === 'open') {
    return gateway
  }

  dialing ??= dial()
    .then(next => {
      gateway = next

      return next
    })
    .finally(() => {
      dialing = null
    })

  return dialing
}

/** `OnboardingContext.requestGateway` for the wizard window. */
export async function wizardRequestGateway<T = unknown>(
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  const socket = await ensureGateway()

  return socket.request<T>(method, params ?? {})
}

/** Context the classic onboarding flows run under inside the wizard. */
export function createWizardOnboardingContext(onCompleted: () => void): OnboardingContext {
  return { onCompleted, requestGateway: wizardRequestGateway }
}
