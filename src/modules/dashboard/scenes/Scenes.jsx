import { motion, useTransform } from 'motion/react'

/*
 * Cenas ilustrativas das seções do dashboard. Cada uma recebe `progress` (MotionValue 0→1)
 * e anima apenas transform/opacity/pathLength — barato até em dispositivos modestos.
 * São ilustrações do que cada ferramenta faz, não resultados de processamento.
 */

const W = 560
const H = 380

function Frame({ children, title }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="scene" role="presentation">
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="14" className="scene__frame" />
      <rect x="1" y="1" width={W - 2} height="34" rx="14" className="scene__bar" />
      <rect x="1" y="20" width={W - 2} height="15" className="scene__bar" />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={22 + i * 16} cy="18" r="4.5" className={`scene__dot scene__dot--${i}`} />
      ))}
      <text x={W / 2} y="22" textAnchor="middle" className="scene__title">
        {title}
      </text>
      {children}
    </svg>
  )
}

/** Valor que vai de 0 a 1 dentro da janela [a, b] do progresso. */
function useWindow(progress, a, b) {
  return useTransform(progress, [a, b], [0, 1], { clamp: true })
}

/* ───────────────────────── JSON ───────────────────────── */

const JSON_LINES = [
  { t: '{', d: 0 },
  { t: '"usuario": {', d: 1, k: true },
  { t: '"id": 101,', d: 2, k: true },
  { t: '"nome": "Ana",', d: 2, k: true },
  { t: '"tags": ["dev", "ops"]', d: 2, k: true },
  { t: '},', d: 1 },
  { t: '"ativo": true', d: 1, k: true },
  { t: '}', d: 0 },
]

function JsonLine({ progress, line, i }) {
  const w = useWindow(progress, 0.05 + i * 0.045, 0.3 + i * 0.045)
  const seed = (i * 73) % 11
  const x = useTransform(w, [0, 1], [(seed - 5) * 34, 0])
  const y = useTransform(w, [0, 1], [(((i * 37) % 9) - 4) * 30, 0])
  const rotate = useTransform(w, [0, 1], [(seed - 5) * 6, 0])
  const opacity = useTransform(w, [0, 0.4, 1], [0, 0.6, 1])
  const hl = useWindow(progress, 0.48 + i * 0.02, 0.52 + i * 0.02)
  const hlOpacity = useTransform(hl, [0, 0.5, 1], [0, 0.9, 0.25])
  const [key, rest] = line.k ? [line.t.slice(0, line.t.indexOf(':') + 1), line.t.slice(line.t.indexOf(':') + 1)] : [null, line.t]
  return (
    <motion.g style={{ x, y, rotate, opacity }}>
      <motion.rect x={24} y={58 + i * 28 - 15} width={240} height={22} rx={4} className="scene__hl" style={{ opacity: hlOpacity }} />
      <text x={32 + line.d * 18} y={58 + i * 28} className="scene__code">
        {key && <tspan className="scene__key">{key}</tspan>}
        <tspan className={rest.includes('"') ? 'scene__str' : rest.match(/\d|true/) ? 'scene__num' : 'scene__punct'}>{rest}</tspan>
      </text>
    </motion.g>
  )
}

const TREE = [
  { id: 'root', x: 340, y: 90, label: '{ }', parent: null },
  { id: 'usuario', x: 400, y: 150, label: 'usuario', parent: 'root' },
  { id: 'ativo', x: 400, y: 300, label: 'ativo', parent: 'root' },
  { id: 'id', x: 480, y: 120, label: 'id', parent: 'usuario' },
  { id: 'nome', x: 480, y: 175, label: 'nome', parent: 'usuario' },
  { id: 'tags', x: 480, y: 230, label: 'tags [2]', parent: 'usuario' },
]

function TreeNode({ progress, node, i }) {
  const w = useWindow(progress, 0.55 + i * 0.05, 0.68 + i * 0.05)
  const scale = useTransform(w, [0, 1], [0.4, 1])
  const parent = TREE.find((n) => n.id === node.parent)
  return (
    <g>
      {parent && (
        <motion.path
          d={`M ${parent.x + 22} ${parent.y} C ${parent.x + 40} ${parent.y}, ${node.x - 40} ${node.y}, ${node.x - 22} ${node.y}`}
          className="scene__edge"
          style={{ pathLength: w }}
        />
      )}
      <motion.g style={{ opacity: w, scale, transformOrigin: `${node.x}px ${node.y}px` }}>
        <rect x={node.x - 22} y={node.y - 12} width={i === 0 ? 44 : 64} height={24} rx={6} className={`scene__node ${i === 0 ? 'is-root' : ''}`} />
        <text x={node.x + (i === 0 ? 0 : 10)} y={node.y + 4} textAnchor="middle" className="scene__node-label">
          {node.label}
        </text>
      </motion.g>
    </g>
  )
}

export function JsonScene({ progress }) {
  return (
    <Frame title="exemplo.json">
      {JSON_LINES.map((l, i) => (
        <JsonLine key={i} progress={progress} line={l} i={i} />
      ))}
      {TREE.map((n, i) => (
        <TreeNode key={n.id} progress={progress} node={n} i={i} />
      ))}
    </Frame>
  )
}

/* ───────────────────────── CRON ───────────────────────── */

const CRON_FIELDS = [
  { v: '0', l: 'seg' },
  { v: '30', l: 'min' },
  { v: '9', l: 'hora' },
  { v: '*', l: 'dia' },
  { v: '*', l: 'mês' },
  { v: '1-5', l: 'sem' },
]

function CronChip({ progress, f, i }) {
  const w = useWindow(progress, 0.08 + i * 0.07, 0.2 + i * 0.07)
  const y = useTransform(w, [0, 1], [-40, 0])
  const glow = useWindow(progress, 0.55 + i * 0.05, 0.62 + i * 0.05)
  const glowOpacity = useTransform(glow, [0, 0.5, 1], [0, 1, 0.3])
  const x = 40 + i * 82
  return (
    <motion.g style={{ opacity: w, y }}>
      <rect x={x} y={220} width={70} height={54} rx={8} className="scene__chip" />
      <motion.rect x={x} y={220} width={70} height={54} rx={8} className="scene__chip-glow" style={{ opacity: glowOpacity }} />
      <text x={x + 35} y={252} textAnchor="middle" className="scene__chip-v">
        {f.v}
      </text>
      <text x={x + 35} y={268} textAnchor="middle" className="scene__chip-l">
        {f.l}
      </text>
    </motion.g>
  )
}

function Particle({ progress, i }) {
  const start = 0.3 + i * 0.06
  const w = useWindow(progress, start, start + 0.35)
  const x = useTransform(w, [0, 1], [40, 110 + i * 75])
  const opacity = useTransform(w, [0, 0.15, 1], [0, 1, 1])
  return <motion.circle cx={0} cy={330} r={5} className="scene__particle" style={{ x, opacity }} />
}

export function CronScene({ progress }) {
  // relógio: 08:50 → 09:30 conforme o scroll
  const minutes = useTransform(progress, [0, 1], [8 * 60 + 50, 9 * 60 + 30])
  const clock = useTransform(minutes, (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`)
  const ring = useTransform(progress, [0, 1], [0, 1])
  return (
    <Frame title="exemplo · 0 30 9 * * 1-5">
      <motion.circle cx={W / 2} cy={112} r={54} className="scene__ring-bg" />
      <motion.circle cx={W / 2} cy={112} r={54} className="scene__ring" style={{ pathLength: ring, rotate: -90, transformOrigin: `${W / 2}px 112px` }} />
      <motion.text x={W / 2} y={124} textAnchor="middle" className="scene__clock">
        {clock}
      </motion.text>
      <text x={W / 2} y={196} textAnchor="middle" className="scene__clock-sub">
        próxima execução · 09:30
      </text>
      {CRON_FIELDS.map((f, i) => (
        <CronChip key={i} progress={progress} f={f} i={i} />
      ))}
      <line x1={40} x2={W - 40} y1={330} y2={330} className="scene__track" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Particle key={i} progress={progress} i={i} />
      ))}
      {['seg', 'ter', 'qua', 'qui', 'sex'].map((d, i) => (
        <text key={d} x={110 + i * 75} y={355} textAnchor="middle" className="scene__chip-l">
          {d}
        </text>
      ))}
    </Frame>
  )
}

/* ───────────────────────── XML ───────────────────────── */

const XML_LINES = [
  { t: 'Colaborador', kind: 'open', d: 0 },
  { t: 'Nome', kind: 'inline', d: 1, text: 'Pedro' },
  { t: 'Empresa', kind: 'open', d: 1 },
  { t: 'Nome', kind: 'inline', d: 2, text: 'JBS' },
  { t: 'Empresa', kind: 'close', d: 1 },
  { t: 'Colaborador', kind: 'close', d: 0 },
]

function XmlLine({ progress, line, i }) {
  const w = useWindow(progress, 0.06 + i * 0.07, 0.2 + i * 0.07)
  const x = useTransform(w, [0, 1], [-30, 0])
  const pairStart = line.d === 0 ? 0.6 : line.d === 1 ? 0.7 : 0.8
  const glow = useWindow(progress, pairStart, pairStart + 0.08)
  const glowOpacity = useTransform(glow, [0, 1], [0, 1])
  const y = 82 + i * 46
  const lx = 60 + line.d * 40
  const color = `var(--depth-${line.d})`
  const label = line.kind === 'close' ? `</${line.t}>` : `<${line.t}>`
  return (
    <motion.g style={{ opacity: w, x }}>
      <motion.rect x={lx - 10} y={y - 20} width={line.kind === 'inline' ? 230 : 170} height={30} rx={6} style={{ opacity: glowOpacity, fill: color }} className="scene__xml-glow" />
      <text x={lx} y={y} className="scene__xml" style={{ fill: color }}>
        {label}
        {line.kind === 'inline' && (
          <>
            <tspan className="scene__xml-text">{line.text}</tspan>
            <tspan>{`</${line.t}>`}</tspan>
          </>
        )}
      </text>
    </motion.g>
  )
}

function Guide({ progress, d, from, to }) {
  const w = useWindow(progress, 0.45 + d * 0.08, 0.6 + d * 0.08)
  return (
    <motion.line
      x1={52 + d * 40}
      x2={52 + d * 40}
      y1={82 + from * 46 + 8}
      y2={82 + to * 46 - 22}
      className="scene__guide"
      style={{ pathLength: w, stroke: `var(--depth-${d})` }}
    />
  )
}

export function XmlScene({ progress }) {
  return (
    <Frame title="exemplo.xml">
      <Guide progress={progress} d={0} from={0} to={5} />
      <Guide progress={progress} d={1} from={2} to={4} />
      {XML_LINES.map((l, i) => (
        <XmlLine key={i} progress={progress} line={l} i={i} />
      ))}
    </Frame>
  )
}

/* ───────────────────────── DB ───────────────────────── */

const TABLES = [
  { id: 'dep', name: 'Departamento', cols: ['Id', 'Nome'], pk: [0], fk: [], from: { x: 330, y: 230, r: 14 }, to: { x: 40, y: 80 } },
  { id: 'col', name: 'Colaborador', cols: ['Id', 'Nome', 'IdDepartamento'], pk: [0], fk: [2], from: { x: 60, y: 250, r: -12 }, to: { x: 320, y: 60 } },
  { id: 'proj', name: 'Projeto', cols: ['Id', 'IdDepartamento'], pk: [0], fk: [1], from: { x: 300, y: 70, r: 8 }, to: { x: 320, y: 230 } },
]

function DbTable({ progress, t, i }) {
  const appear = useWindow(progress, 0.04 + i * 0.08, 0.18 + i * 0.08)
  const arrange = useWindow(progress, 0.3, 0.55)
  const x = useTransform(arrange, [0, 1], [t.from.x, t.to.x])
  const y = useTransform(arrange, [0, 1], [t.from.y, t.to.y])
  const rotate = useTransform(arrange, [0, 1], [t.from.r, 0])
  const h = 30 + t.cols.length * 22
  return (
    <motion.g style={{ x, y, rotate, opacity: appear }}>
      <rect width={200} height={h} rx={8} className="scene__table" />
      <path d={`M0 8 a8 8 0 0 1 8 -8 H192 a8 8 0 0 1 8 8 V30 H0 Z`} className="scene__table-head" />
      <text x={14} y={20} className="scene__table-name">
        {t.name}
      </text>
      {t.cols.map((c, ci) => (
        <text key={c} x={14} y={48 + ci * 22} className={`scene__table-col ${t.pk.includes(ci) ? 'is-pk' : ''} ${t.fk.includes(ci) ? 'is-fk' : ''}`}>
          <tspan className="scene__table-key">{t.pk.includes(ci) ? 'PK' : t.fk.includes(ci) ? 'FK' : ''}</tspan>
          <tspan x={40}>{c}</tspan>
        </text>
      ))}
    </motion.g>
  )
}

function DbEdge({ progress, d, i }) {
  const w = useWindow(progress, 0.58 + i * 0.08, 0.78 + i * 0.08)
  return <motion.path d={d} className="scene__rel" style={{ pathLength: w }} />
}

export function DbScene({ progress }) {
  const sym = useWindow(progress, 0.85, 0.95)
  return (
    <Frame title="exemplo.sql → diagrama">
      <DbEdge progress={progress} i={0} d="M 320 147 C 270 147, 280 108, 240 108" />
      <DbEdge progress={progress} i={1} d="M 320 297 C 270 297, 280 130, 240 130" />
      {TABLES.map((t, i) => (
        <DbTable key={t.id} progress={progress} t={t} i={i} />
      ))}
      <motion.g style={{ opacity: sym }}>
        <text x={246} y={102} className="scene__card">||</text>
        <text x={300} y={142} className="scene__card">o&lt;</text>
        <text x={300} y={292} className="scene__card">o&lt;</text>
      </motion.g>
    </Frame>
  )
}
