/**
 * Runtime tests for the mobile app's pure TypeScript modules.
 *
 * `testEnvironment: 'node'` rather than the `jest-expo` preset on purpose: the
 * modules under test (`src/api.ts`, `src/i18n.ts`) import no React Native
 * components, so they need no React Native runtime — only stand-ins for the two
 * native storage modules, wired below. That keeps the suite fast and free of
 * the whole Metro/Babel RN transform chain. Testing the screens themselves
 * would need `jest-expo` + `@testing-library/react-native`; that is a separate,
 * larger piece of work and is not what this suite claims to cover.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/test/mocks/async-storage.ts',
    '^expo-secure-store$': '<rootDir>/test/mocks/expo-secure-store.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      // The app's own tsconfig sets moduleResolution: 'bundler' for Metro,
      // which is incompatible with the CommonJS modules ts-jest emits.
      { tsconfig: '<rootDir>/tsconfig.spec.json' },
    ],
  },
  clearMocks: true,
};
