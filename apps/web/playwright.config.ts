import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'list',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // No `webServer` yet: nothing is served worth walking. The E2E smoke test
  // that walks all fourteen routes in both themes and both states (AGENTS.md,
  // Validation) needs routes first, and will add `webServer` then.
})
