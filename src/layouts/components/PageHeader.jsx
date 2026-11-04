import { motion } from 'motion/react'
import Icon from '@core/components/Icon'

/** Cabeçalho padrão dos módulos: eyebrow técnico + título + descrição + ações. */
export default function PageHeader({ icon, eyebrow, title, description, actions }) {
  return (
    <motion.div
      className="page-header"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div>
        {eyebrow && (
          <span className="page-header__eyebrow">
            {icon && <Icon path={icon} size={14} />}
            {eyebrow}
          </span>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </motion.div>
  )
}
