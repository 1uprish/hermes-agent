import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { SubmissionDestination } from '../app/submissionDestination.js'
import type { QueueItem } from '../hooks/useQueue.js'

const directory = (home?: string) =>
  join(home ?? process.env.HERMES_HOME ?? join(homedir(), '.hermes'), 'tui-pending-inputs')

const recordName = /^[0-9a-f-]{36}\.json$/

function syncDirectory(dir: string) {
  if (process.platform === 'win32') {
    return
  }
  const fd = openSync(dir, 'r')

  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// Separate files avoid read/modify/write loss between two native clients.
export function savePendingInput(item: QueueItem): void {
  if (!item.submissionId || !item.destination?.sid) {
    return
  }
  const dir = directory(item.destination?.profileHome)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, `${item.submissionId}.json`)
  const temporary = `${path}.${process.pid}.tmp`
  const { submissionId, destination, display, text, preparedText, inFlight, failed, createdAt, queued } = item
  writeFileSync(
    temporary,
    JSON.stringify({
      submissionId,
      destination,
      display,
      text,
      preparedText,
      createdAt,
      queued,
      attempted: inFlight || failed
    }),
    { mode: 0o600, flush: true }
  )
  renameSync(temporary, path)
  syncDirectory(dir)
}

export function removePendingInput(item: QueueItem): void {
  if (!item.submissionId) {
    return
  }
  const dir = directory(item.destination?.profileHome)

  if (!existsSync(dir)) {
    return
  }
  rmSync(join(dir, `${item.submissionId}.json`), { force: true })
  syncDirectory(dir)
}

export function loadPendingInputs(destination: SubmissionDestination): QueueItem[] {
  const dir = directory(destination.profileHome)

  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir)
    .filter(name => recordName.test(name))
    .flatMap(name => {
      // A missing record is a concurrent client's acknowledgement, not corruption.
      let raw: string

      try {
        raw = readFileSync(join(dir, name), 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return []
        }
        throw error
      }

      const record = JSON.parse(raw)

      if (
        record.submissionId + '.json' !== name ||
        typeof record.text !== 'string' ||
        typeof record.display !== 'string'
      ) {
        throw new Error(`Invalid pending input record: ${name}`)
      }

      if (record.destination?.sid !== destination.sid || record.destination?.profile !== destination.profile) {
        return []
      }

      return [{ ...record, inFlight: false, failed: Boolean(record.attempted) }]
    })
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}
