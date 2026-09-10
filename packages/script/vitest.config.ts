import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // Note when reading the table: the text reporter lists only files that
      // have uncovered lines, so a short table means most files are at 100%,
      // not that they were skipped. `skipFull: false` does not change this in
      // vitest 5. Add `--coverage.reporter=json` to see every file.
      // The model and the operations. Test support and the compile-time
      // guarantee file are not production surface.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
    },
  },
})
