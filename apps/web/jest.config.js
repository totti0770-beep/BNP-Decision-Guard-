/**
 * Runtime tests for the web app's pure TypeScript modules.
 *
 * `testEnvironment: 'node'` rather than jsdom on purpose, mirroring
 * `apps/mobile/jest.config.js`: the modules under test (`src/lib/api.ts`,
 * `src/lib/i18n.ts`) import no React and render nothing. `api.ts` touches two
 * browser globals — `window.location` and `localStorage` — and `test/setup.ts`
 * installs small stand-ins for exactly those, so a test can assert what was
 * written to storage and where the page was sent. Component tests would need
 * jsdom plus `@testing-library/react`; that is separate work and not what this
 * suite claims to cover.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      // The app's tsconfig sets moduleResolution: 'bundler' for Next, which is
      // incompatible with the CommonJS modules ts-jest emits.
      { tsconfig: '<rootDir>/tsconfig.spec.json' },
    ],
  },
  clearMocks: true,
};
