import { Link } from 'react-router'
import { mdiMapMarkerQuestionOutline } from '@mdi/js'
import { EmptyState } from '@core/components/ui'
import Button from '@core/components/Button'

export default function NotFound() {
  return (
    <EmptyState
      icon={mdiMapMarkerQuestionOutline}
      title="404 — módulo não encontrado"
      description="O caminho acessado não corresponde a nenhuma ferramenta do workspace."
      action={
        <Link to="/">
          <Button>Voltar ao Dashboard</Button>
        </Link>
      }
    />
  )
}
