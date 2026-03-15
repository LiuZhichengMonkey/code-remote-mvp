module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/evolver/',
    '/src/multi-agent/test.ts',
    '/src/multi-agent/test-',
    '/src/__tests__/e2e.test.ts',  // E2E 测试需要先构建 CLI
    '/src/__tests__/handler.test.ts',   // 依赖 chalk ESM
    '/src/__tests__/server.test.ts',    // 依赖 chalk ESM
    '/src/__tests__/auth.test.ts',      // 依赖 chalk ESM
    '/src/__tests__/EventBus.test.ts',  // 依赖 chalk ESM
    '/src/__tests__/cli-integration.test.ts' // 依赖 chalk ESM
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(chalk|ansi-styles|supports-color|color-convert|color-name|escape-string-regexp|slice-ansi|strip-ansi)/)'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/test*.ts',
    '!src/**/__tests__/**',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
