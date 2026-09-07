import { createFileRoute, Outlet } from '@tanstack/react-router'
import { PublicFooter } from '@/components/layout/public-footer'
import { PublicHeader } from '@/components/layout/public-header'

export const Route = createFileRoute('/_public')({
  component: PublicLayout,
})

/**
 * dvh, not vh.
 *
 * 100vh is the large viewport, which assumes the mobile browser chrome is
 * retracted. With the URL bar on screen the visible viewport is smaller, so a
 * short page like the login form was scrollable by exactly that difference and
 * the entire scroll was empty surface. dvh tracks the viewport actually shown.
 */
function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <PublicHeader />
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  )
}
