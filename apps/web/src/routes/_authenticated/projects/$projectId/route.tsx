import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { activeTabForPath } from '@/components/project/detail/active-tab'
import { ProjectTabs } from '@/components/project/detail/project-tabs'
import { BackButton } from '@/components/ui/back-button'
import { useProject } from '@/hooks/use-projects'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/projects/$projectId')({
  component: ProjectDetailLayout,
})

/**
 * The chrome every tabbed project page shares, mounted once above them.
 *
 * Each tab used to be a sibling route that printed its own back link, its own
 * project title and its own copy of the tab strip. React unmounts a route
 * subtree when the address changes, so moving between Ikhtisar, Milestone,
 * Dokumen and Waktu tore the whole header down and built an identical one
 * back up: the title flashed to nothing while the new page's own `useProject`
 * resolved, and the strip jumped. This is a pathless layout - the file adds no
 * segment, so every URL is what it was - and it is the parent of all of them,
 * so the header and the strip stay mounted and only the outlet swaps.
 *
 * Two deliberate exclusions:
 *
 * - The drill-ins (scoping, BRD, PRD, checkout, matching) are not tabs. They
 *   are reached from the content, they return to the project rather than to
 *   the list, and they have no entry in `TABS`. The layout renders nothing but
 *   the outlet for them, leaving those pages exactly as they were.
 * - The header waits for the project. Every tab still owns its loading,
 *   error and not-found screens, and a tab strip hanging over "project not
 *   found" would be chrome for something that is not there.
 */
function ProjectDetailLayout() {
  const { projectId } = Route.useParams()
  // A talent has no owner project list to return to, only their own home.
  const role = useAuthStore((s) => s.user?.role)
  const { data: project } = useProject(projectId)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeTab = activeTabForPath(pathname)

  if (!activeTab || !project) return <Outlet />

  return (
    <div className="bg-surface p-6 lg:p-8">
      <BackButton to={role === 'talent' ? '/talent' : '/projects'} />
      <ProjectTabs projectId={projectId} active={activeTab} title={project.title} />
      <Outlet />
    </div>
  )
}
