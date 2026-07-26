import { QueryClient } from '@tanstack/react-query'

/**
 * The app's single query cache.
 *
 * Lives here rather than inside the root route so that non-component code can
 * reach it - logout has to clear it, or one account's cached project, message
 * and payment data stays readable to whoever signs in next on the same browser.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
})
