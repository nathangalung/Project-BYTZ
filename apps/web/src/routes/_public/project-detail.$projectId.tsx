import { createFileRoute } from '@tanstack/react-router'
import { ProjectDetailView } from '@/components/project/project-detail-view'

export const Route = createFileRoute('/_public/project-detail/$projectId')({
  component: PublicProjectDetail,
})

// Anonymous browsing: the public shell, back to the public list.
function PublicProjectDetail() {
  const { projectId } = Route.useParams()
  return <ProjectDetailView projectId={projectId} backTo="/browse-projects" />
}
