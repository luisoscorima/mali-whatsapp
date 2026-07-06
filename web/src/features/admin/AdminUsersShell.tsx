import { useParams } from 'react-router-dom'
import { MasterDetailShell } from '@/shared/ui/shell/MasterDetailShell'
import { AdminUsersListSidebar } from './AdminUsersListSidebar'

export function AdminUsersShell() {
  const { id } = useParams()
  const selectedId =
    id && id !== 'new' && /^\d+$/.test(id) ? Number(id) : null

  return (
    <MasterDetailShell
      sidebar={<AdminUsersListSidebar selectedId={selectedId} />}
    />
  )
}
