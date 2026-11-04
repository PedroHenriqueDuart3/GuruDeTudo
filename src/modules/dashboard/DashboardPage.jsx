import { motion } from 'motion/react'
import { TOOLS } from '@/navigation'
import ActivityPanel from './components/ActivityPanel'
import Hero from './components/Hero'
import ScrollSection from './components/ScrollSection'
import ToolCard from './components/ToolCard'
import { CronScene, DbScene, JsonScene, SqlForgeScene, XmlScene } from './scenes/Scenes'
import './dashboard.css'

const SCENES = { json: JsonScene, cron: CronScene, xml: XmlScene, db: DbScene, sqlforge: SqlForgeScene }

export default function DashboardPage() {
  return (
    <div className="dashboard">
      <Hero />

      <section className="dash-section" id="modulos" aria-labelledby="dash-tools">
        <motion.header className="dash-section__head" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <span className="mono dash-section__eyebrow">// módulos</span>
          <h2 id="dash-tools">Escolha uma ferramenta</h2>
        </motion.header>
        <div className="tool-grid">
          {TOOLS.map((t, i) => (
            <ToolCard key={t.id} tool={t} index={i} />
          ))}
        </div>
      </section>

      <section className="dash-section" aria-label="Atividade">
        <ActivityPanel />
      </section>

      <div className="dash-tour">
        <motion.header className="dash-section__head dash-tour__head" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <span className="mono dash-section__eyebrow">// tour</span>
          <h2>Role para explorar cada módulo</h2>
        </motion.header>
        {TOOLS.map((t, i) => (
          <ScrollSection key={t.id} tool={t} index={i} Scene={SCENES[t.id]} accent={t.accent} />
        ))}
      </div>

      <footer className="dash-footer">
        <span>DevTools Workspace</span>
        <span className="subtle">Processamento local · seus arquivos nunca saem do navegador</span>
      </footer>
    </div>
  )
}
