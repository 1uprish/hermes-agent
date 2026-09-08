import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaneTab, PaneTabLabel } from './pane-tab'

afterEach(cleanup)

describe('PaneTab hover preview', () => {
  it('dismisses before a drag handler that claims the pointer event', async () => {
    const onPointerDown = vi.fn(event => {
      event.preventDefault()
      event.stopPropagation()
    })

    render(
      <PaneTab hoverDescription="example.com" hoverTitle="Full page title" onPointerDown={onPointerDown} role="tab">
        <PaneTabLabel>Short title</PaneTabLabel>
      </PaneTab>
    )
    const tab = screen.getByRole('tab')
    fireEvent.pointerMove(tab, { pointerType: 'mouse' })
    const preview = await screen.findByRole('tooltip')
    expect(within(preview).getByText('Full page title')).toBeTruthy()
    expect(within(preview).getByText('example.com')).toBeTruthy()

    fireEvent.pointerDown(tab, { button: 0, pointerType: 'mouse' })
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    expect(onPointerDown).toHaveBeenCalledOnce()
    expect(screen.getByRole('tab')).toBe(tab)
  })

  it('closes a preview and the tab without activating the tab when its close button is pressed', async () => {
    const onClose = vi.fn()
    const onPointerDown = vi.fn()
    render(
      <PaneTab hoverTitle="Full page title" onClose={onClose} onPointerDown={onPointerDown} role="tab">
        <PaneTabLabel>Short title</PaneTabLabel>
      </PaneTab>
    )
    fireEvent.pointerMove(screen.getByRole('tab'), { pointerType: 'mouse' })
    await screen.findByRole('tooltip')

    const close = screen.getByRole('button', { name: 'Close' })
    fireEvent.pointerDown(close, { button: 0, pointerType: 'mouse' })
    fireEvent.click(close)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    expect(onClose).toHaveBeenCalledOnce()
    expect(onPointerDown).not.toHaveBeenCalled()
  })
})
