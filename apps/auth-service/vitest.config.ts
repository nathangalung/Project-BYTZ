import { workspaceConfig } from '../../vitest.shared'

export default workspaceConfig({
  include: ['src/**/*.ts'],
  thresholds: { statements: 67, branches: 53, functions: 53, lines: 67 },
})
