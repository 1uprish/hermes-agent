import { randomUUID } from 'node:crypto'

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { captureDestination, type SubmissionDestination } from '../app/submissionDestination.js'
import { $uiState, getUiState } from '../app/uiStore.js'
import { loadPendingInputs, removePendingInput, savePendingInput } from '../lib/pendingInputs.js'

export interface QueueItem {
  display: string
  text: string
  queued?: boolean
  createdAt?: number
  submissionId?: string
  destination?: SubmissionDestination
  inFlight?: boolean
  failed?: boolean
  preparedText?: string
  settle?: (accepted: boolean) => void
}

export const queueItem = (text: string, display = text): QueueItem => ({ display, text })

export function prependQueueItem(queue: QueueItem[], item: QueueItem): void {
  queue.unshift(item)
}

export function takeQueueItem(queue: QueueItem[], index: number, editedDisplay?: string): QueueItem | undefined {
  if (index < 0 || index >= queue.length) {
    return undefined
  }

  const [item] = queue.splice(index, 1)

  if (!item || editedDisplay === undefined) {
    return item
  }

  const text = editedDisplay.includes(item.display) ? editedDisplay.replace(item.display, item.text) : editedDisplay

  return text === item.text ? { ...item, display: editedDisplay } : { display: editedDisplay, text }
}

// Mutates `arr` in place; returned reference is the same input array, kept
// so callers can chain. Use `Array.prototype.toSpliced` if you need a copy.
export function removeAtInPlace<T>(arr: T[], i: number): T[] {
  if (i < 0 || i >= arr.length) {
    return arr
  }

  arr.splice(i, 1)

  return arr
}

interface PendingQueue {
  edit: number | null
  items: QueueItem[]
}

export function useQueue() {
  const ui = useStore($uiState)
  const queues = useRef(new Map<string, PendingQueue>())
  const unbound = useRef<PendingQueue>({ edit: null, items: [] })
  const [, refresh] = useState(0)

  const getQueue = useCallback((destination = captureDestination()) => {
    const { sid, profile } = destination

    if (!sid) {
      return unbound.current
    }

    const key = JSON.stringify([profile, sid])
    let queue = queues.current.get(key)

    if (!queue) {
      queue = { edit: null, items: loadPendingInputs(destination) }
      queues.current.set(key, queue)
    }

    // Input typed before any session exists belongs to the next attachment,
    // unlike a bound session's queue, which must never migrate on navigation.
    if (unbound.current.items.length) {
      const offset = queue.items.length

      for (const item of unbound.current.items) {
        item.destination = destination
        savePendingInput(item)
        queue.items.push(item)
      }

      if (unbound.current.edit !== null) {
        queue.edit = offset + unbound.current.edit
      }

      unbound.current = { edit: null, items: [] }
    }

    return queue
  }, [])

  // Resolve on access, not in an effect: navigation and a drain can happen
  // before React renders again, including through an older input callback.
  const queueRef = useMemo(
    () => ({
      get current() {
        return getQueue().items
      }
    }),
    [getQueue]
  )

  const queueEditRef = useMemo(
    () => ({
      get current() {
        return getQueue().edit
      },
      set current(value: number | null) {
        getQueue().edit = value
      }
    }),
    [getQueue]
  )

  const queuedDisplay = [
    ...queueRef.current.map(item => `${item.failed ? '[unconfirmed · Alt+K retry] ' : ''}${item.display}`),
    ...(ui.info?.pending_submissions ?? []).map(item => `[${item.status} · ${item.admission_id}] ${item.user}`)
  ]

  const queueEditIdx = queueEditRef.current
  const syncQueue = useCallback(() => refresh(version => version + 1), [])

  const setQueueEdit = useCallback(
    (idx: number | null) => {
      queueEditRef.current = idx
      syncQueue()
    },
    [queueEditRef, syncQueue]
  )

  const enqueue = useCallback(
    (text: string, display = text, destination?: SubmissionDestination) => {
      const owner = destination ?? captureDestination()
      const queue = getQueue(owner)

      const item = {
        ...queueItem(text, display),
        submissionId: randomUUID(),
        destination: owner,
        createdAt: Math.max(Date.now(), (queue.items.at(-1)?.createdAt ?? 0) + 1)
      }

      savePendingInput(item)
      queue.items.push(item)
      syncQueue()

      return item
    },
    [getQueue, syncQueue]
  )

  const prependQ = useCallback(
    (item: QueueItem, destination?: SubmissionDestination) => {
      const queue = getQueue(destination)
      item.inFlight = false
      item.submissionId ??= randomUUID()
      item.destination ??= destination ?? captureDestination()
      savePendingInput(item)

      if (!queue.items.includes(item)) {
        prependQueueItem(queue.items, item)
      }
      syncQueue()
    },
    [getQueue, syncQueue]
  )

  const claim = useCallback(
    (queue: PendingQueue, item: QueueItem) => {
      item.submissionId ??= randomUUID()
      item.destination ??= captureDestination()
      item.inFlight = true
      item.failed = false
      savePendingInput(item)
      let confirmed = false

      item.settle = accepted => {
        if (confirmed) {
          return
        }
        confirmed = accepted
        item.inFlight = false
        item.failed = !accepted

        if (accepted) {
          removePendingInput(item)
          removeAtInPlace(queue.items, queue.items.indexOf(item))
        } else {
          savePendingInput(item)
        }

        syncQueue()
      }

      syncQueue()

      return item
    },
    [syncQueue]
  )

  useEffect(() => {
    const queue = getQueue()

    for (const receipt of getUiState().info?.pending_submissions ?? []) {
      const item = queue.items.find(
        item =>
          item.submissionId === receipt.admission_id &&
          item.destination?.sid === receipt.target_session_id &&
          item.destination?.profileHome === receipt.target_profile_home
      )

      if (!item) {
        continue
      }

      if (item.settle) {
        item.settle(true)
      } else {
        removePendingInput(item)
        removeAtInPlace(queue.items, queue.items.indexOf(item))
        syncQueue()
      }
    }
  }, [ui.info, getQueue, syncQueue])

  const stage = useCallback(
    (text: string, display = text, destination = captureDestination()) => {
      const item = enqueue(text, display, destination)
      item.queued = false

      return claim(getQueue(destination), item)
    },
    [enqueue, claim, getQueue]
  )

  const dequeue = useCallback(
    (retry = false) => {
      const queue = getQueue()
      const item = queue.items[0]

      if (!item || item.inFlight || (item.failed && !retry)) {
        return undefined
      }

      return claim(queue, item)
    },
    [getQueue, claim]
  )

  const takeQ = useCallback(
    (i: number, editedDisplay?: string) => {
      const queue = getQueue()

      if (queue.items[i]?.inFlight) {
        return undefined
      }
      const previous = queue.items[i]
      const item = takeQueueItem(queue.items, i, editedDisplay)

      if (!item) {
        return undefined
      }

      if (previous && previous.submissionId !== item.submissionId) {
        removePendingInput(previous)
      }
      queue.items.splice(i, 0, item)

      return claim(queue, item)
    },
    [getQueue, claim]
  )

  const removeQ = useCallback(
    (i: number) => {
      if (queueRef.current[i]?.inFlight) {
        return
      }
      const item = queueRef.current[i]

      if (item) {
        removePendingInput(item)
      }
      removeAtInPlace(queueRef.current, i)
      syncQueue()
    },
    [queueRef, syncQueue]
  )

  return {
    dequeue,
    stage,
    enqueue,
    prependQ,
    queueEditIdx,
    queueEditRef,
    queueRef,
    queuedDisplay,
    removeQ,
    setQueueEdit,
    takeQ
  }
}
