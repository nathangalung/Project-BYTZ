import { projectEnvSchema, validateEnv } from '@kerjacus/config'

export const env = validateEnv(projectEnvSchema)
