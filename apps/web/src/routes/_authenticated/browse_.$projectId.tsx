import { createFileRoute } from '@tanstack/react-router'
import { ProjectDetailView } from '@/components/project/project-detail-view'

export const Route = createFileRoute('/_authenticated/browse_/$projectId')({
  component: BrowseProjectDetail,
})

// A signed-in talent opening a project keeps the app shell, so it never reads
// as a logout, and returns to the authenticated browse list.
function BrowseProjectDetail() {
  const { projectId } = Route.useParams()
  return <ProjectDetailView projectId={projectId} backTo="/browse" />
}
