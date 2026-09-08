import { beforeEach, expect, it } from 'vitest'

import { $queuedPromptsBySession, enqueueQueuedPrompt, getQueuedPrompts } from './composer-queue'
import { reconcilePendingSubmissions, trackPendingSubmission } from './pending-submissions'

beforeEach(() => {
  window.localStorage.clear()
  $queuedPromptsBySession.set({})
})

it('reconciles server queue by identity without replaying or duplicating local entries', () => {
  enqueueQueuedPrompt('chat', { id: 'one', text: 'same', attachments: [] })
  enqueueQueuedPrompt('chat', { id: 'local', text: 'same', attachments: [] })
  const snapshot = [{ admission_id: 'one', status: 'queued', text: 'same' }]
  reconcilePendingSubmissions('chat', snapshot)
  reconcilePendingSubmissions('chat', snapshot)
  expect(getQueuedPrompts('chat').map(entry => entry.id)).toEqual(['one', 'local'])
  expect(getQueuedPrompts('chat')[0]?.serverStatus).toBe('queued')
  reconcilePendingSubmissions('chat', [{ ...snapshot[0], status: 'started' }])
  expect(getQueuedPrompts('chat').map(entry => entry.id)).toEqual(['local'])
  reconcilePendingSubmissions('chat', [{ admission_id: 'unknown', status: 'unknown', text: 'interrupted' }])
  expect(getQueuedPrompts('chat').find(entry => entry.id === 'unknown')?.serverStatus).toBe('unknown')
  reconcilePendingSubmissions('chat', [])
  expect(getQueuedPrompts('chat').map(entry => entry.id)).toEqual(['local'])
})

it('persists identified direct submissions independently of the automatic local queue', () => {
  trackPendingSubmission('chat', { id: 'direct', text: 'hello' })
  const stored = JSON.parse(window.localStorage.getItem('hermes.desktop.pendingSubmissions.v1')!)
  expect(stored.chat.direct).toMatchObject({ id: 'direct', text: 'hello' })
  expect(getQueuedPrompts('chat')).toEqual([])
})
