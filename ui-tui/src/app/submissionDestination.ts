import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { getUiState } from './uiStore.js'

export interface SubmissionDestination {
  readonly sid: string | null
  readonly profile: string
  readonly profileHome: string
}

export function captureDestination(): SubmissionDestination {
  const { sid, info } = getUiState()

  return Object.freeze({
    sid,
    profile: info?.profile_name || 'default',
    profileHome: resolve(process.env.HERMES_HOME ?? join(homedir(), '.hermes'))
  })
}

export function isCurrentDestination(destination: SubmissionDestination): boolean {
  const current = captureDestination()

  return (
    current.sid === destination.sid &&
    current.profile === destination.profile &&
    current.profileHome === destination.profileHome
  )
}
