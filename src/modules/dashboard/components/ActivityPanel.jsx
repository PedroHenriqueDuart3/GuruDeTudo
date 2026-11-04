import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { mdiDeleteSweepOutline, mdiHistory, mdiStarOutline } from '@mdi/js'
import Button from '@core/components/Button'
import Icon from '@core/components/Icon'
import { Card, EmptyState } from '@core/components/ui'
import { timeAgo } from '@core/utils'
import { getTool } from '@/navigation'
import { useActivity } from '@/stores/activity'

/** Ferramentas recentes, favoritas e o histórico local de ações reais do usuário. */
export default function ActivityPanel() {
  const { history, recent, favorites, clearHistory } = useActivity()

  return (
    <div className="activity">
      <Card title="Acesso rápido" icon={mdiStarOutline} className="activity__quick">
        <div className="activity__group">
          <span className="activity__label">Favoritas</span>
          {favorites.length ? (
            <div className="activity__chips">
              {favorites.map((id) => {
                const t = getTool(id)
                return t ? (
                  <Link key={id} to={t.path} className="activity__chip">
                    <Icon path={t.icon} size={16} /> {t.title}
                  </Link>
                ) : null
              })}
            </div>
          ) : (
            <p className="muted">Marque ferramentas com a estrela para fixá-las aqui.</p>
          )}
        </div>
        <div className="activity__group">
          <span className="activity__label">Recentes</span>
          {recent.length ? (
            <div className="activity__chips">
              {recent.map((r) => {
                const t = getTool(r.tool)
                return t ? (
                  <Link key={r.tool} to={t.path} className="activity__chip activity__chip--ghost">
                    <Icon path={t.icon} size={16} /> {t.title} <span className="subtle">{timeAgo(r.at)}</span>
                  </Link>
                ) : null
              })}
            </div>
          ) : (
            <p className="muted">As ferramentas abertas aparecem aqui.</p>
          )}
        </div>
      </Card>

      <Card
        title="Histórico de atividades"
        subtitle="Salvo apenas neste navegador · somente metadados, nunca o conteúdo"
        icon={mdiHistory}
        className="activity__history"
        actions={
          history.length > 0 && (
            <Button size="sm" variant="text" icon={mdiDeleteSweepOutline} onClick={clearHistory}>
              Limpar
            </Button>
          )
        }
      >
        {history.length ? (
          <ol className="activity__list">
            <AnimatePresence initial={false}>
              {history.slice(0, 12).map((h) => {
                const t = getTool(h.tool)
                return (
                  <motion.li key={h.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    <span className={`activity__icon activity__icon--${t?.accent ?? 'neon'}`}>{t && <Icon path={t.icon} size={14} />}</span>
                    <span className="grow">
                      <strong>{h.action}</strong>
                      {h.detail && <span className="activity__detail mono">{h.detail}</span>}
                    </span>
                    <span className="subtle activity__time">{timeAgo(h.at)}</span>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ol>
        ) : (
          <EmptyState icon={mdiHistory} title="Nenhuma atividade ainda" description="Formatações, exportações, cópias e importações feitas nas ferramentas aparecerão aqui." />
        )}
      </Card>
    </div>
  )
}
