import { workspaceConfig } from '../../vitest.shared'

export default workspaceConfig({
  include: ['src/**/*.ts'],
  thresholds: { statements: 100, branches: 99, functions: 100, lines: 100 },
})
