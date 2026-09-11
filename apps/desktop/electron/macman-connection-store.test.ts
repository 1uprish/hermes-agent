import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, test } from 'vitest'

import { createMacManConnectionStore } from './macman-connection-store'

const temporaryDirectories: string[] = []

function temporaryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), 'macman-connections-'))
  temporaryDirectories.push(directory)

  return join(directory, 'connections.sqlite3')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

test('message ingestion is durable and idempotent across connector retries', () => {
  const databasePath = temporaryDatabase()
  const store = createMacManConnectionStore({ databasePath })

  store.upsertAccount({ connector: 'whatsapp', displayName: 'Personal WhatsApp', externalId: '15551234567' })
  store.upsertConversation({
    accountExternalId: '15551234567',
    connector: 'whatsapp',
    displayName: 'Annie',
    externalId: 'annie-chat'
  })

  const first = store.ingestMessage({
    accountExternalId: '15551234567',
    connector: 'whatsapp',
    conversationExternalId: 'annie-chat',
    direction: 'inbound',
    externalId: 'wa-message-1',
    senderExternalId: 'annie',
    sentAt: '2026-09-10T08:00:00.000Z',
    text: 'Passport scan attached'
  })
  const replay = store.ingestMessage({
    accountExternalId: '15551234567',
    connector: 'whatsapp',
    conversationExternalId: 'annie-chat',
    direction: 'inbound',
    externalId: 'wa-message-1',
    senderExternalId: 'annie',
    sentAt: '2026-09-10T08:00:00.000Z',
    text: 'Passport scan attached'
  })

  assert.equal(replay.id, first.id)
  assert.deepEqual(store.searchMessages({ connector: 'whatsapp', query: 'passport' }), [
    {
      ...first,
      accountExternalId: '15551234567',
      connector: 'whatsapp',
      conversationDisplayName: 'Annie',
      conversationExternalId: 'annie-chat',
      direction: 'inbound',
      externalId: 'wa-message-1',
      senderExternalId: 'annie',
      sentAt: '2026-09-10T08:00:00.000Z',
      text: 'Passport scan attached'
    }
  ])

  store.close()

  const reopened = createMacManConnectionStore({ databasePath })
  assert.equal(reopened.searchMessages({ query: 'passport' }).length, 1)
  reopened.close()
})

test('connected account receipts survive an app restart without exposing connector secrets', () => {
  const databasePath = temporaryDatabase()
  const store = createMacManConnectionStore({ databasePath })

  store.upsertAccount({ connector: 'imessage', displayName: 'Messages on this Mac', externalId: 'local-messages' })
  assert.deepEqual(store.listAccounts('imessage'), [
    {
      connector: 'imessage',
      displayName: 'Messages on this Mac',
      externalId: 'local-messages'
    }
  ])
  store.close()

  const reopened = createMacManConnectionStore({ databasePath })
  assert.deepEqual(reopened.listAccounts('imessage'), [
    {
      connector: 'imessage',
      displayName: 'Messages on this Mac',
      externalId: 'local-messages'
    }
  ])
  reopened.close()
})

test('connection enablement can be disconnected and reconnected without deleting account data', () => {
  const databasePath = temporaryDatabase()
  const store = createMacManConnectionStore({ databasePath })

  store.upsertAccount({ connector: 'imessage', displayName: 'Messages on this Mac', externalId: 'local-messages:v1' })
  assert.equal(store.getConnectionEnabled('imessage'), undefined)

  store.setConnectionEnabled('imessage', false)
  assert.equal(store.getConnectionEnabled('imessage'), false)
  assert.equal(store.listAccounts('imessage').length, 1)
  store.close()

  const reopened = createMacManConnectionStore({ databasePath })
  assert.equal(reopened.getConnectionEnabled('imessage'), false)
  reopened.setConnectionEnabled('imessage', true)
  assert.equal(reopened.getConnectionEnabled('imessage'), true)
  assert.equal(reopened.listAccounts('imessage').length, 1)
  reopened.close()
})

test('an idempotency key can enqueue exactly one outbound action', () => {
  const store = createMacManConnectionStore({ databasePath: temporaryDatabase() })
  const request = {
    accountExternalId: 'me@gmail.com',
    connector: 'gmail' as const,
    idempotencyKey: 'forward-wa-message-1-to-john',
    kind: 'email' as const,
    payload: { attachmentMessageId: 'wa-message-1', subject: 'Passport', text: 'Here you go' },
    target: 'john@example.com'
  }

  const first = store.enqueueOutbox(request)
  const replay = store.enqueueOutbox(request)

  assert.equal(replay.id, first.id)
  assert.equal(store.listOutbox().length, 1)
  assert.equal(first.status, 'pending')

  assert.throws(
    () => store.enqueueOutbox({ ...request, payload: { ...request.payload, text: 'Changed after enqueue' } }),
    /idempotency key.*different outbound action/i
  )

  store.close()
})

test('failed delivery stays retryable and a provider receipt seals the action', () => {
  let now = '2026-09-10T09:00:00.000Z'
  const store = createMacManConnectionStore({ databasePath: temporaryDatabase(), now: () => now })
  const queued = store.enqueueOutbox({
    accountExternalId: '15551234567',
    connector: 'imessage',
    idempotencyKey: 'message-annie-once',
    kind: 'message',
    payload: { text: 'Where can we get 30/25 preforms?' },
    target: 'annie'
  })

  store.markOutboxSending(queued.id)
  now = '2026-09-10T09:00:05.000Z'
  store.markOutboxFailed(queued.id, { error: 'Messages timed out', retryAt: '2026-09-10T09:01:00.000Z' })

  assert.deepEqual(store.getOutbox(queued.id), {
    ...queued,
    attempts: 1,
    error: 'Messages timed out',
    retryAt: '2026-09-10T09:01:00.000Z',
    status: 'failed',
    updatedAt: now
  })

  store.markOutboxSending(queued.id)
  now = '2026-09-10T09:00:15.000Z'
  store.markOutboxSent(queued.id, { providerReceiptId: 'imessage-guid-1' })

  assert.deepEqual(store.getOutbox(queued.id), {
    ...queued,
    attempts: 2,
    providerReceiptId: 'imessage-guid-1',
    status: 'sent',
    updatedAt: now
  })

  store.close()
})
