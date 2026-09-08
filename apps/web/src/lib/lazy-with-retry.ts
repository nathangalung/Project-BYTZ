import { type ComponentType, lazy } from 'react'

/**
 * `React.lazy`, but a failed chunk fetch does not strand the page on its
 * fallback forever.
 *
 * Two things combine to make the plain version dangerous here. Suspense has no
 * timeout and no error path of its own, so a rejected import leaves the
 * fallback rendered until something above it catches the throw. And `lazy`
 * calls its factory once and caches whatever it returns, rejection included, so
 * the same component never tries again even after the network recovers. The
 * Gantt tab and the time-tracking chart are both loaded this way, which is why
 * "the chart just keeps loading" is reachable from one dropped request.
 *
 * The retries sit inside the factory because that is the only place `lazy`
 * will run more than once. Backoff is short and bounded: this is a static asset
 * on the same origin, so a fetch that fails three times a second apart is not
 * going to succeed on the fourth.
 *
 * A chunk missing after a deploy is the one case retrying cannot fix, since the
 * hashed filename in the cached HTML no longer exists. That is left to the
 * error boundary above, which offers a reload rather than reloading on its own:
 * a page that reloads itself takes any unsent work with it.
 */
export function lazyWithRetry<P extends object>(
  factory: () => Promise<{ default: ComponentType<P> }>,
  attempts = 3,
  delayMs = 300,
) {
  return lazy(async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await factory()
      } catch (err) {
        lastError = err
        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
        }
      }
    }
    throw lastError
  })
}
