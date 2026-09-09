import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PermissionsAccessSettings } from './permissions-access-settings'

afterEach(cleanup)

describe('Permissions & Access settings', () => {
  it('reuses MacMan permission status outside first-run onboarding', () => {
    render(
      <PermissionsAccessSettings
        loading={false}
        onGrantAccess={vi.fn()}
        onRefresh={vi.fn()}
        snapshot={{
          permissions: { accessibility: true, screenRecording: true },
          state: 'running',
          supported: true
        }}
      />
    )

    expect(screen.getByRole('heading', { name: 'Permissions & Access' })).toBeTruthy()
    expect(screen.getByText('Computer control')).toBeTruthy()
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Full Disk Access')).toBeTruthy()
    expect(screen.getByText('Only needed for local iMessage or unrestricted file access.')).toBeTruthy()
  })
})
