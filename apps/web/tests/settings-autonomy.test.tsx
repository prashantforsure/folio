import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The autonomy switch in account settings - roadmap task 3.7, ADR 0003 D1.
 * Live, off by default (`review`), written through `setAssistantAutonomy`,
 * put back if the write is refused, and saying under it what no setting
 * skips.
 */

const spies = vi.hoisted(() => ({ setAssistantAutonomy: vi.fn() }))

vi.mock('../lib/settings/actions', () => ({
  setAssistantAutonomy: (...args: readonly unknown[]) => spies.setAssistantAutonomy(...args),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  signOutEverywhere: vi.fn(),
  deleteAccount: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/app/settings' }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { readonly href: string; readonly children: ReactNode }) => <a href={href}>{children}</a>,
}))

const { SettingsWorkspace } = await import('../app/(app)/app/(home)/settings/settings-workspace')
const { ThemeProvider } = await import('../lib/state/theme')

const workspace = (autonomy: 'review' | 'auto') =>
  render(
    <ThemeProvider>
      <SettingsWorkspace
      user={{ id: '7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b' as never, email: 'writer@example.com', displayName: 'A Writer', initials: 'AW', avatarUrl: null }}
      credits={{ settled: 0, reserved: 0, available: 0 }}
      projects={[]}
      ledger={[]}
      collaborators={[]}
      autonomy={autonomy}
      />
    </ThemeProvider>,
  )

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const openEditorDefaults = () => {
  fireEvent.click(screen.getAllByRole('button', { name: /Editor defaults/u })[0] as HTMLElement)
  return screen.getByRole('switch', { name: 'Apply proposals automatically' })
}

describe('Apply proposals automatically', () => {
  it('is off by default - review - and says what it never skips', () => {
    workspace('review')
    expect(openEditorDefaults().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(/a rename, a merge, a delete, a format change, undoing a run and anything that costs credits always ask you first/u)).toBeTruthy()
  })

  it('turns on, and writes auto', async () => {
    spies.setAssistantAutonomy.mockResolvedValue({ status: 'saved', autonomy: 'auto' })
    workspace('review')
    const toggle = openEditorDefaults()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(spies.setAssistantAutonomy).toHaveBeenCalledWith('auto'))
  })

  it('goes back and says why when the write is refused', async () => {
    spies.setAssistantAutonomy.mockResolvedValue({ status: 'error', message: 'Choose review or automatic.' })
    workspace('auto')
    const toggle = openEditorDefaults()
    fireEvent.click(toggle)
    await screen.findByText('Choose review or automatic.')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})
