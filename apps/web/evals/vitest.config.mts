import { defineConfig } from 'vitest/config'

/**
 * The eval harness's runner - roadmap task 5.5, ADR 0003 **D19**: on demand,
 * never in CI. `pnpm eval` (in `apps/web`, or `pnpm eval` at the root) runs
 * it; `pnpm test` never does, because its config includes `tests/` alone and
 * this one includes `evals/**` alone.
 *
 * The environment is the app's own `.env` (the database, `ANTHROPIC_API_KEY`),
 * loaded here with Node's own loader because nothing else loads it outside
 * Next. Two variables are the harness's: `EVAL_USER_EMAIL`, the account the
 * scratch projects belong to, and `EVAL_STORIES`, a comma-separated list of
 * fixture ids to run instead of all ten. They are read here - a test-runner
 * config may read the environment (`eslint.config.mjs`) - and handed to the run
 * with `provide`.
 */

for (const file of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(file)
  } catch {
    // Absent: the variables may be in the environment already.
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['evals/**/*.eval.ts'],
    testTimeout: 0,
    hookTimeout: 0,
    fileParallelism: false,
    provide: {
      evalUser: process.env['EVAL_USER_EMAIL'] ?? null,
      evalStories: process.env['EVAL_STORIES'] ?? null,
    },
  },
})
