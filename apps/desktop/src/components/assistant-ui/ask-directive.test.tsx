// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const submit = vi.fn((_text: string) => true)

vi.mock('@/app/chat/composer/focus', () => ({
  requestComposerSubmit: (text: string) => submit(text)
}))

import { AskDirective } from '@/components/assistant-ui/ask-directive'

describe('::ask directive', () => {
  afterEach(() => {
    cleanup()
    submit.mockClear()
  })

  it('renders option pills and submits the pick as a visible turn', () => {
    render(
      <AskDirective attrs={{ options: 'Lead story|Exclusive|Embargoed brief', question: 'Which angle leads?' }} streaming={false} />
    )

    expect(screen.getByText('Which angle leads?')).toBeTruthy()
    fireEvent.click(screen.getByText('Exclusive'))
    expect(submit).toHaveBeenCalledWith('Exclusive')

    // Settled: pills disable, no double submit.
    fireEvent.click(screen.getByText('Lead story'))
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('renders a type-and-go row when input is requested', () => {
    render(<AskDirective attrs={{ input: 'true', placeholder: 'e.g. 24 months', question: 'Runway?' }} streaming={false} />)

    const input = screen.getByPlaceholderText('e.g. 24 months')
    fireEvent.change(input, { target: { value: '18 months' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(submit).toHaveBeenCalledWith('18 months')
  })

  it('renders nothing without a question or any affordance', () => {
    const { container } = render(<AskDirective attrs={{ question: 'Orphan?' }} streaming={false} />)

    expect(container.textContent).toBe('')
  })

  it('stays inert while streaming', () => {
    render(<AskDirective attrs={{ options: 'A|B', question: 'Pick' }} streaming={true} />)

    fireEvent.click(screen.getByText('A'))
    expect(submit).not.toHaveBeenCalled()
  })
})
