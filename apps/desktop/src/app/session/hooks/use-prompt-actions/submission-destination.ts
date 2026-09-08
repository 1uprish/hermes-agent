import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'
import { requestForSessionProfile, type SessionOwnerScope } from '@/store/session-request-router'
import { knownOwnerForSession } from '@/store/session-states'

import type { GatewayRequest } from './utils'

const capturedRequests = new WeakMap<GatewayRequest, SubmissionDestination>()

export interface SubmissionDestination {
  readonly owner: SessionOwnerScope
  readonly requestGateway: GatewayRequest
}

/** Capture before preprocessing, not when the prepared payload finally sends.
 * Unknown legacy owners may use the existing dispatcher only while its ambient
 * connection/profile is unchanged; a write must never fall to a new socket. */
export function captureSubmissionDestination(
  sessionId: string | null | undefined,
  request: GatewayRequest
): SubmissionDestination {
  const captured = capturedRequests.get(request)

  if (captured) {return captured}
  const knownOwner = knownOwnerForSession(sessionId)
  const owner = knownOwner && typeof knownOwner === 'object' ? Object.freeze({ ...knownOwner }) : knownOwner
  const connection = $connection.get()
  const profile = $activeGatewayProfile.get()

  const guardedRequest: GatewayRequest = (method, params, timeoutMs) => {
    if (connection !== $connection.get() || profile !== $activeGatewayProfile.get()) {
      return Promise.reject(new Error('Submission destination changed; retry from the original session'))
    }

    return timeoutMs === undefined ? request(method, params) : request(method, params, timeoutMs)
  }

  const destination = Object.freeze({
    owner,
    requestGateway: <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) =>
      typeof owner === 'object' && owner !== null
        ? requestForSessionProfile<T>(owner, guardedRequest, method, params, timeoutMs)
        : guardedRequest<T>(method, params, timeoutMs)
  })

  capturedRequests.set(destination.requestGateway, destination)

  return destination
}
