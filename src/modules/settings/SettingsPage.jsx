import { useMemo } from 'react'
import { mdiCogOutline, mdiDeleteOutline, mdiMotionPlayOutline, mdiPaletteOutline, mdiRestore, mdiShieldLockOutline, mdiTextBoxEditOutline, mdiTimerCogOutline } from '@mdi/js'
import Button from '@core/components/Button'
import { useToast } from '@core/components/Toast'
import { Card, Segmented, Select, Switch } from '@core/components/ui'
import { formatNumber } from '@core/utils'
import PageHeader from '@layouts/components/PageHeader'
import { useActivity } from '@/stores/activity'
import { useSettings } from '@/stores/settings'
import { FORMATS } from '@modules/cron/lib/cronSpec'
import { DIALECTS } from '@modules/dbdiagram/lib/sql/dialects'
import './settings.css'

export default function SettingsPage() {
  const s = useSettings()
  const { history, favorites, clearHistory, clearFavorites } = useActivity()
  const toast = useToast()
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      return [s.timezone]
    }
  }, [s.timezone])

  return (
    <div className="settings">
      <PageHeader icon={mdiCogOutline} eyebrow="Sistema" title="Configurações" description="Preferências salvas apenas neste navegador (localStorage). Nenhuma informação é enviada a servidores." />

      <div className="settings__grid">
        <Card title="Aparência" icon={mdiPaletteOutline}>
          <div className="settings__row">
            <span className="field__label">Tema</span>
            <Segmented
              value={s.theme}
              onChange={(theme) => s.set({ theme })}
              ariaLabel="Tema"
              options={[
                { value: 'dark', label: 'Escuro' },
                { value: 'light', label: 'Claro' },
                { value: 'system', label: 'Sistema' },
              ]}
            />
          </div>
          <Switch checked={s.sidebarCollapsed} onChange={(v) => s.set({ sidebarCollapsed: v })} label="Menu lateral recolhido" description="Mostra apenas os ícones na barra lateral." />
        </Card>

        <Card title="Movimento" icon={mdiMotionPlayOutline}>
          <div className="settings__row">
            <span className="field__label">Animações</span>
            <Segmented
              value={s.motion}
              onChange={(motion) => s.set({ motion })}
              ariaLabel="Preferência de movimento"
              options={[
                { value: 'system', label: 'Seguir sistema' },
                { value: 'reduced', label: 'Reduzidas' },
                { value: 'full', label: 'Completas' },
              ]}
            />
          </div>
          <p className="muted settings__note">
            “Seguir sistema” respeita a opção de reduzir movimento do sistema operacional. Em “Reduzidas”, as animações de scroll mostram direto o estado final.
          </p>
        </Card>

        <Card title="Editores" icon={mdiTextBoxEditOutline}>
          <div className="settings__row">
            <span className="field__label">Tamanho da fonte · {s.editorFontSize}px</span>
            <input type="range" min={11} max={18} value={s.editorFontSize} onChange={(e) => s.set({ editorFontSize: Number(e.target.value) })} aria-label="Tamanho da fonte do editor" className="settings__range" />
          </div>
          <Select
            label="Indentação padrão do JSON"
            value={s.indent}
            onChange={(e) => s.set({ indent: Number(e.target.value) })}
            options={[
              { value: 2, label: '2 espaços' },
              { value: 4, label: '4 espaços' },
            ]}
          />
          <Switch checked={s.wrapLines} onChange={(v) => s.set({ wrapLines: v })} label="Quebra de linha automática" description="Linhas longas quebram em vez de rolar na horizontal." />
          <Select
            label="Dialeto SQL padrão"
            value={s.sqlDialect}
            onChange={(e) => s.set({ sqlDialect: e.target.value })}
            options={Object.values(DIALECTS).map((d) => ({ value: d.id, label: d.label }))}
          />
        </Card>

        <Card title="CRON" icon={mdiTimerCogOutline}>
          <Select label="Formato padrão" value={s.cronFormat} onChange={(e) => s.set({ cronFormat: e.target.value })} options={Object.values(FORMATS).map((f) => ({ value: f.id, label: f.label }))} />
          <Select label="Fuso horário" value={s.timezone} onChange={(e) => s.set({ timezone: e.target.value })} options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} hint="Usado no cálculo das próximas execuções." />
        </Card>

        <Card title="Dados locais" icon={mdiShieldLockOutline}>
          <p className="muted settings__note">
            {formatNumber(history.length)} registro(s) no histórico · {favorites.length} favorita(s). O conteúdo dos arquivos nunca é armazenado.
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button variant="outlined" size="sm" icon={mdiDeleteOutline} onClick={() => (clearHistory(), toast.success('Histórico apagado'))} disabled={!history.length}>
              Limpar histórico
            </Button>
            <Button variant="outlined" size="sm" icon={mdiDeleteOutline} onClick={() => (clearFavorites(), toast.success('Favoritas removidas'))} disabled={!favorites.length}>
              Limpar favoritas
            </Button>
            <Button variant="danger" size="sm" icon={mdiRestore} onClick={() => (s.reset(), toast.success('Configurações restauradas'))}>
              Restaurar padrões
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
