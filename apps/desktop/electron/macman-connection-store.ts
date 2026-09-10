import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type MacManConnectorId = 'gmail' | 'imessage' | 'whatsapp'
export type MacManMessageDirection = 'inbound' | 'outbound'
export type MacManOutboxKind = 'email' | 'message'
export type MacManOutboxStatus = 'failed' | 'pending' | 'sending' | 'sent'

export interface MacManStoredMessage {
  accountExternalId: string
  connector: MacManConnectorId
  conversationDisplayName?: string
  conversationExternalId: string
  direction: MacManMessageDirection
  externalId: string
  id: string
  senderExternalId?: string
  sentAt: string
  text: string
}

export interface MacManOutboxRecord {
  accountExternalId: string
  attempts: number
  connector: MacManConnectorId
  createdAt: string
  error?: string
  id: string
  idempotencyKey: string
  kind: MacManOutboxKind
  payload: Record<string, unknown>
  providerReceiptId?: string
  retryAt?: string
  status: MacManOutboxStatus
  target: string
  updatedAt: string
}

interface StoreOptions {
  databasePath: string
  now?: () => string
}

interface AccountInput {
  connector: MacManConnectorId
  displayName: string
  externalId: string
}

interface ConversationInput {
  accountExternalId: string
  connector: MacManConnectorId
  displayName?: string
  externalId: string
}

interface MessageInput extends Omit<MacManStoredMessage, 'conversationDisplayName' | 'id'> {}

interface SearchInput {
  connector?: MacManConnectorId
  limit?: number
  query: string
}

interface EnqueueInput {
  accountExternalId: string
  connector: MacManConnectorId
  idempotencyKey: string
  kind: MacManOutboxKind
  payload: Record<string, unknown>
  target: string
}

function nonEmpty(value: string, label: string): string {
  const normalized = String(value || '').trim()

  if (!normalized) {
    throw new Error(`${label} must not be empty`)
  }

  return normalized
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))

    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }

  return JSON.stringify(value)
}

function payloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(stableJson(payload)).digest('hex')
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function outboxRecord(row: Record<string, unknown>): MacManOutboxRecord {
  return {
    accountExternalId: String(row.account_external_id),
    attempts: Number(row.attempts),
    connector: String(row.connector) as MacManConnectorId,
    createdAt: String(row.created_at),
    ...(optionalString(row.error) ? { error: String(row.error) } : {}),
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    kind: String(row.kind) as MacManOutboxKind,
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    ...(optionalString(row.provider_receipt_id) ? { providerReceiptId: String(row.provider_receipt_id) } : {}),
    ...(optionalString(row.retry_at) ? { retryAt: String(row.retry_at) } : {}),
    status: String(row.status) as MacManOutboxStatus,
    target: String(row.target),
    updatedAt: String(row.updated_at)
  }
}

export function createMacManConnectionStore({ databasePath, now = () => new Date().toISOString() }: StoreOptions) {
  mkdirSync(dirname(databasePath), { mode: 0o700, recursive: true })
  const database = new DatabaseSync(databasePath)
  chmodSync(databasePath, 0o600)

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      connector TEXT NOT NULL CHECK (connector IN ('whatsapp', 'imessage', 'gmail')),
      external_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (connector, external_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (account_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      connector TEXT NOT NULL CHECK (connector IN ('whatsapp', 'imessage', 'gmail')),
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      sender_external_id TEXT,
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      text TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (connector, account_id, external_id)
    );

    CREATE INDEX IF NOT EXISTS messages_search_idx ON messages(connector, sent_at DESC);
    CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, sent_at DESC);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      filename TEXT,
      mime_type TEXT,
      local_path TEXT,
      size_bytes INTEGER,
      UNIQUE (message_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS sync_cursors (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      stream TEXT NOT NULL,
      cursor TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, stream)
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      connector TEXT NOT NULL CHECK (connector IN ('whatsapp', 'imessage', 'gmail')),
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('message', 'email')),
      target TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'failed', 'sent')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      retry_at TEXT,
      provider_receipt_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS outbox_dispatch_idx ON outbox(status, retry_at, created_at);
  `)

  function accountId(connector: MacManConnectorId, externalId: string): string | undefined {
    const row = database
      .prepare('SELECT id FROM accounts WHERE connector = ? AND external_id = ?')
      .get(connector, externalId) as { id?: string } | undefined

    return row?.id
  }

  function upsertAccount(input: AccountInput): string {
    const connector = input.connector
    const externalId = nonEmpty(input.externalId, 'Account external id')
    const displayName = nonEmpty(input.displayName, 'Account display name')
    const timestamp = now()
    const existing = accountId(connector, externalId)
    const id = existing ?? randomUUID()

    database
      .prepare(`
        INSERT INTO accounts (id, connector, external_id, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (connector, external_id) DO UPDATE SET
          display_name = excluded.display_name,
          updated_at = excluded.updated_at
      `)
      .run(id, connector, externalId, displayName, timestamp, timestamp)

    return existing ?? id
  }

  function ensureAccount(connector: MacManConnectorId, externalId: string): string {
    return accountId(connector, externalId) ?? upsertAccount({ connector, displayName: externalId, externalId })
  }

  function conversationId(account: string, externalId: string): string | undefined {
    const row = database
      .prepare('SELECT id FROM conversations WHERE account_id = ? AND external_id = ?')
      .get(account, externalId) as { id?: string } | undefined

    return row?.id
  }

  function upsertConversation(input: ConversationInput): string {
    const externalId = nonEmpty(input.externalId, 'Conversation external id')
    const account = ensureAccount(input.connector, nonEmpty(input.accountExternalId, 'Account external id'))
    const existing = conversationId(account, externalId)
    const id = existing ?? randomUUID()
    const timestamp = now()

    database
      .prepare(`
        INSERT INTO conversations (id, account_id, external_id, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (account_id, external_id) DO UPDATE SET
          display_name = COALESCE(excluded.display_name, conversations.display_name),
          updated_at = excluded.updated_at
      `)
      .run(id, account, externalId, input.displayName?.trim() || null, timestamp, timestamp)

    return existing ?? id
  }

  function ingestMessage(input: MessageInput): MacManStoredMessage {
    const accountExternalId = nonEmpty(input.accountExternalId, 'Account external id')
    const conversationExternalId = nonEmpty(input.conversationExternalId, 'Conversation external id')
    const externalId = nonEmpty(input.externalId, 'Message external id')
    const account = ensureAccount(input.connector, accountExternalId)
    const conversation =
      conversationId(account, conversationExternalId) ??
      upsertConversation({ accountExternalId, connector: input.connector, externalId: conversationExternalId })
    const existing = database
      .prepare('SELECT id FROM messages WHERE connector = ? AND account_id = ? AND external_id = ?')
      .get(input.connector, account, externalId) as { id?: string } | undefined
    const id = existing?.id ?? randomUUID()
    const timestamp = now()

    database
      .prepare(`
        INSERT INTO messages (
          id, connector, account_id, conversation_id, external_id, sender_external_id,
          direction, text, sent_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (connector, account_id, external_id) DO UPDATE SET
          conversation_id = excluded.conversation_id,
          sender_external_id = excluded.sender_external_id,
          direction = excluded.direction,
          text = excluded.text,
          sent_at = excluded.sent_at,
          updated_at = excluded.updated_at
      `)
      .run(
        id,
        input.connector,
        account,
        conversation,
        externalId,
        input.senderExternalId?.trim() || null,
        input.direction,
        String(input.text ?? ''),
        nonEmpty(input.sentAt, 'Message sent time'),
        timestamp,
        timestamp
      )

    return {
      accountExternalId,
      connector: input.connector,
      conversationExternalId,
      direction: input.direction,
      externalId,
      id,
      ...(input.senderExternalId?.trim() ? { senderExternalId: input.senderExternalId.trim() } : {}),
      sentAt: input.sentAt,
      text: String(input.text ?? '')
    }
  }

  function searchMessages({ connector, limit = 50, query }: SearchInput): MacManStoredMessage[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
    const escaped = String(query ?? '').trim().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
    const parameters: Array<number | string> = [`%${escaped}%`]
    const connectorClause = connector ? 'AND m.connector = ?' : ''

    if (connector) {
      parameters.push(connector)
    }

    parameters.push(safeLimit)

    const rows = database
      .prepare(`
        SELECT
          m.id,
          m.connector,
          a.external_id AS account_external_id,
          c.external_id AS conversation_external_id,
          c.display_name AS conversation_display_name,
          m.external_id,
          m.sender_external_id,
          m.direction,
          m.text,
          m.sent_at
        FROM messages m
        JOIN accounts a ON a.id = m.account_id
        JOIN conversations c ON c.id = m.conversation_id
        WHERE LOWER(m.text) LIKE LOWER(?) ESCAPE '\\'
        ${connectorClause}
        ORDER BY m.sent_at DESC, m.id DESC
        LIMIT ?
      `)
      .all(...parameters) as Array<Record<string, unknown>>

    return rows.map(row => ({
      accountExternalId: String(row.account_external_id),
      connector: String(row.connector) as MacManConnectorId,
      ...(optionalString(row.conversation_display_name)
        ? { conversationDisplayName: String(row.conversation_display_name) }
        : {}),
      conversationExternalId: String(row.conversation_external_id),
      direction: String(row.direction) as MacManMessageDirection,
      externalId: String(row.external_id),
      id: String(row.id),
      ...(optionalString(row.sender_external_id) ? { senderExternalId: String(row.sender_external_id) } : {}),
      sentAt: String(row.sent_at),
      text: String(row.text)
    }))
  }

  function enqueueOutbox(input: EnqueueInput): MacManOutboxRecord {
    const idempotencyKey = nonEmpty(input.idempotencyKey, 'Idempotency key')
    const serializedPayload = stableJson(input.payload)
    const hash = payloadHash(input.payload)
    const prior = database.prepare('SELECT * FROM outbox WHERE idempotency_key = ?').get(idempotencyKey) as
      | Record<string, unknown>
      | undefined

    if (prior) {
      if (prior.payload_sha256 !== hash || prior.target !== input.target || prior.connector !== input.connector) {
        throw new Error(`Idempotency key ${idempotencyKey} belongs to a different outbound action`)
      }

      return outboxRecord(prior)
    }

    const account = ensureAccount(input.connector, nonEmpty(input.accountExternalId, 'Account external id'))
    const timestamp = now()
    const id = randomUUID()

    database
      .prepare(`
        INSERT INTO outbox (
          id, connector, account_id, kind, target, payload_json, payload_sha256,
          idempotency_key, status, attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      `)
      .run(
        id,
        input.connector,
        account,
        input.kind,
        nonEmpty(input.target, 'Outbound target'),
        serializedPayload,
        hash,
        idempotencyKey,
        timestamp,
        timestamp
      )

    return getOutbox(id) as MacManOutboxRecord
  }

  function getOutbox(id: string): MacManOutboxRecord | undefined {
    const row = database
      .prepare(`
        SELECT o.*, a.external_id AS account_external_id
        FROM outbox o
        JOIN accounts a ON a.id = o.account_id
        WHERE o.id = ?
      `)
      .get(id) as Record<string, unknown> | undefined

    return row ? outboxRecord(row) : undefined
  }

  function listOutbox(): MacManOutboxRecord[] {
    const rows = database
      .prepare(`
        SELECT o.*, a.external_id AS account_external_id
        FROM outbox o
        JOIN accounts a ON a.id = o.account_id
        ORDER BY o.created_at, o.id
      `)
      .all() as Array<Record<string, unknown>>

    return rows.map(outboxRecord)
  }

  function requireOutbox(id: string): void {
    if (!getOutbox(id)) {
      throw new Error(`Outbound action ${id} was not found`)
    }
  }

  function markOutboxSending(id: string): void {
    requireOutbox(id)
    database
      .prepare(`
        UPDATE outbox
        SET status = 'sending', attempts = attempts + 1, error = NULL, retry_at = NULL,
            provider_receipt_id = NULL, updated_at = ?
        WHERE id = ? AND status != 'sent'
      `)
      .run(now(), id)
  }

  function markOutboxFailed(id: string, result: { error: string; retryAt?: string }): void {
    requireOutbox(id)
    database
      .prepare(`
        UPDATE outbox
        SET status = 'failed', error = ?, retry_at = ?, provider_receipt_id = NULL, updated_at = ?
        WHERE id = ? AND status != 'sent'
      `)
      .run(nonEmpty(result.error, 'Delivery error'), result.retryAt?.trim() || null, now(), id)
  }

  function markOutboxSent(id: string, result: { providerReceiptId: string }): void {
    requireOutbox(id)
    database
      .prepare(`
        UPDATE outbox
        SET status = 'sent', error = NULL, retry_at = NULL, provider_receipt_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(nonEmpty(result.providerReceiptId, 'Provider receipt id'), now(), id)
  }

  return {
    close: () => database.close(),
    enqueueOutbox,
    getOutbox,
    ingestMessage,
    listOutbox,
    markOutboxFailed,
    markOutboxSending,
    markOutboxSent,
    searchMessages,
    upsertAccount,
    upsertConversation
  }
}

export type MacManConnectionStore = ReturnType<typeof createMacManConnectionStore>
