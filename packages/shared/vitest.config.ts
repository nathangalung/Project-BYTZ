import { workspaceConfig } from '../../vitest.shared'

export default workspaceConfig({
  include: ['src/**/*.ts'],
  thresholds: { statements: 99, branches: 89, functions: 98, lines: 99 },
})
