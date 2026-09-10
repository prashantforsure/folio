import type { ReactNode } from 'react'

export const metadata = {
  title: 'Folio',
}

// Scaffold only. The signed-in shell, theme and rail belong to a later phase;
// theme is `dark` by default via data-theme, which is not wired up yet.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
