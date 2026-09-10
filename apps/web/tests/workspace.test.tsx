import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME as CONTRACTS } from '@folio/contracts'
import { PACKAGE_NAME as DB } from '@folio/db'
import { PACKAGE_NAME as SCRIPT } from '@folio/script'
import { PACKAGE_NAME as UI } from '@folio/ui'

describe('web scaffold', () => {
  it('resolves every workspace package by name, never by relative path', () => {
    expect([SCRIPT, UI, DB, CONTRACTS]).toEqual([
      '@folio/script',
      '@folio/ui',
      '@folio/db',
      '@folio/contracts',
    ])
  })

  it('renders through Testing Library in a jsdom environment', () => {
    render(<main>{SCRIPT}</main>)
    expect(screen.getByRole('main').textContent).toBe('@folio/script')
  })
})
