import { MasterDetailShell } from '@/shared/ui/shell/MasterDetailShell'
import { ContactsListSidebar } from './ContactsListSidebar'
import { useParams } from 'react-router-dom'

export function ContactsShell() {
  const { id } = useParams()
  const selectedId =
    id && id !== 'new' && id !== 'import' && /^\d+$/.test(id) ? Number(id) : null

  return (
    <MasterDetailShell sidebar={<ContactsListSidebar selectedId={selectedId} />} />
  )
}
