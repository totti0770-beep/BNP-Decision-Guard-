/**
 * Integration ("e2e") suite: real HTTP through the real Nest wiring, against a
 * real PostgreSQL + pgvector database.
 *
 * Deliberately separate from the unit config in package.json, which has
 * rootDir "src" and so never picks these up — note `.e2e-spec.ts` would
 * otherwise match the unit `.*\.spec\.ts$` pattern, which is exactly why these
 * live outside `src/`.
 *
 * Runs in band: every spec shares one database and truncates it on setup, so
 * parallel workers would race each other.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.e2e.json' }],
  },
  testEnvironment: 'node',
  // Env must be set before config/env.ts is imported — `isProduction` is bound
  // at module load, and buildDataSourceOptions() reads process.env directly.
  setupFiles: ['<rootDir>/test/support/env.ts'],
  maxWorkers: 1,
  testTimeout: 60_000,
};
