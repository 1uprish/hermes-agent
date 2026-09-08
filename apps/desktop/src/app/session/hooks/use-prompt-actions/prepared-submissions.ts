import type { ComposerAttachment } from '@/store/composer'
import type { SessionOwnerScope } from '@/store/session-request-router'

import type { SubmissionDestination } from './submission-destination'
import type { SubmitTextOptions } from './utils'

const STORAGE_KEY = 'hermes.desktop.preparedSubmissions.v1'

export interface PreparedSubmission {
  id: string
  owner: SessionOwnerScope
  attachments: ComposerAttachment[]
  text: string
  displayText?: string
  params: Record<string, unknown>
  legacyAttempted?: boolean
}

// A journal, not an automatic outbox. Only an explicit retry may reuse an
// uncertain admission. Read storage each time so a remount cannot lose it.
function readJournal(): Record<string, PreparedSubmission> {
  const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid prepared submission journal')
  }

  return parsed as Record<string, PreparedSubmission>
}

export function preparedSubmissionKey(
  target: string | null | undefined,
  destination: SubmissionDestination,
  rawText: string,
  attachments: ComposerAttachment[],
  options?: SubmitTextOptions
): string {
  return JSON.stringify([
    destination.scopeKey,
    target,
    options?.retryText ?? rawText,
    attachments.map(a => a.occurrenceId ?? a.id),
    options?.displayKind,
    Boolean(options?.fromQueue),
    // Slash expands once, then retries the prepared wire payload, not a new
    // generated ID/expansion. Explicit queue IDs remain distinct intents.
    options?.retryText && !options.fromQueue ? null : options?.submission_id
  ])
}

export function readPreparedSubmission(key: string): PreparedSubmission | undefined {
  return readJournal()[key]
}

export function writePreparedSubmission(key: string, entry: PreparedSubmission): void {
  const journal = readJournal()
  journal[key] = entry
  // Fail before sending if persistence fails; never claim a volatile ID is durable.
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(journal))
}

export function removePreparedSubmission(key: string): void {
  const journal = readJournal()
  delete journal[key]
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(journal))
}
