/**
 * Which connection auth-service talks to.
 *
 * Better Auth holds sessions in Postgres and wants a direct connection, so
 * DATABASE_DIRECT_URL wins where a deployment provides one. DATABASE_URL is
 * the fallback for deployments that publish only the pooled address.
 *
 * It lives here because both call sites spelled the same rule out separately
 * and had already drifted -- one fell back to the validated env, the other to
 * raw process.env. Written inline it was also a branch decided by whoever ran
 * the process: CI sets DATABASE_DIRECT_URL and covers one side, a developer
 * without it covers the other, and auth-service failed its own 100 percent
 * branch threshold in CI while passing locally.
 *
 * Empty counts as absent. The inline version used ??, which only rejects null
 * and undefined, so a compose file declaring DATABASE_DIRECT_URL with nothing
 * behind it handed an empty string to getDb instead of falling back -- and an
 * unset variable in a compose environment block is exactly how that happens.
 */
function present(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined
}

export function resolveDatabaseUrl(fallback?: string): string | undefined {
  return (
    present(process.env.DATABASE_DIRECT_URL) ??
    present(fallback) ??
    present(process.env.DATABASE_URL)
  )
}
