import { workspaceConfig } from '../../vitest.shared'

export default workspaceConfig({
  include: ['src/**/*.ts'],
  thresholds: { statements: 74, branches: 59, functions: 62, lines: 74 },
})
