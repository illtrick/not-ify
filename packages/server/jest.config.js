module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js'],
  coverageDirectory: 'coverage',
  // Each test file gets a fresh module registry
  resetModules: true,
  // Timeout: 10s for API integration tests that may involve async mocks
  testTimeout: 10000,
  // Suppress console output in tests (keep test output clean)
  silent: false,
  // Force exit after tests complete (search tests have open handle leak)
  forceExit: true,
};
