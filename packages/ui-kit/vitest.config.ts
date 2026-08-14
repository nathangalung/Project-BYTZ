import { workspaceConfig } from '../../vitest.shared'

export default workspaceConfig({
  include: ['src/**/*.ts'],
  thresholds: { statements: 90, branches: 100, functions: 83, lines: 90 },
})
