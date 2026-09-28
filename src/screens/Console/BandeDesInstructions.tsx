import type { IconName } from '../../design/icons/names'
import { useT } from '../../i18n/LanguageContext'
import { type Tab, TabStrip } from '../../ui/TabStrip/TabStrip'
import styles from './BandeDesInstructions.module.css'
import type { Etape, StatutEtape } from './useExecution'

/**
 * La largeur au-delà de laquelle un onglet de résultat coupe sa requête à l'ellipse.
 *
 * **Une cote que le handoff ne donne pas**, parce qu'il ne connaît aucun onglet dont le libellé soit
 * une requête : celle-ci est choisie pour que trois onglets tiennent côte à côte dans la largeur
 * ordinaire du centre, et la requête entière se lit au survol prolongé.
 */
const LARGEUR_MAX = 240

type BandeDesInstructionsProps = {
  etapes: readonly Etape[]
  choisie: number
  onChoisir: (index: number) => void
}

/**
 * Un onglet par instruction d'une suite (#156), au-dessus du résultat.
 *
 * **La bande d'onglets des tables et des consoles, et non une seconde** : `TabStrip`, avec sa cote,
 * son filet d'accent et son fond actif. Elle ne ferme ni ne déplace rien ici — un résultat n'est pas
 * un objet qu'on range —, donc ni croix ni glisser-déposer.
 *
 * **Chaque onglet porte sa requête**, sur une ligne, coupée à l'ellipse ; le survol prolongé la
 * rend entière, retours à la ligne compris. Le rang n'y est pas : l'ordre de la bande le dit déjà.
 *
 * **Le statut a deux signes, jamais la seule couleur** : une icône, et un suffixe écrit pour ce qui
 * n'a pas réussi — « échec », « non exécutée », « en cours ». Le suffixe entre dans le nom
 * accessible ; l'icône, décorative, non.
 *
 * Rendue seulement à partir de deux instructions : un onglet unique ne désignerait rien.
 */
export function BandeDesInstructions({ etapes, choisie, onChoisir }: BandeDesInstructionsProps) {
  const t = useT()
  if (etapes.length < 2) return null

  const tabs: Tab[] = etapes.map((etape, index) => {
    const { icon, iconColor } = SIGNE[etape.statut]
    const meta =
      etape.statut === 'erreur'
        ? t('console.suite.echec')
        : etape.statut === 'nonExecutee'
          ? t('console.suite.nonExecutee')
          : etape.statut === 'enCours'
            ? t('console.suite.enCours')
            : undefined
    return {
      id: String(index),
      icon,
      iconColor,
      accentColor: 'var(--accent)',
      label: etape.sql.replace(/\s+/g, ' ').trim(),
      titre: etape.sql,
      meta,
    }
  })

  return (
    <section className={styles.bande} aria-label={t('console.suite.label')}>
      <TabStrip
        tabs={tabs}
        activeId={String(choisie)}
        onSelect={(id) => onChoisir(Number(id))}
        largeurMax={LARGEUR_MAX}
      />
    </section>
  )
}

/** L'icône et sa couleur, par statut — des jetons que les onglets emploient déjà. */
const SIGNE: Record<StatutEtape, { icon: IconName; iconColor: string }> = {
  ok: { icon: 'check', iconColor: 'var(--success)' },
  erreur: { icon: 'warn', iconColor: 'var(--danger-ink)' },
  nonExecutee: { icon: 'x', iconColor: 'var(--ink-4)' },
  enCours: { icon: 'refresh', iconColor: 'var(--ink-3)' },
  attente: { icon: 'clock', iconColor: 'var(--ink-4)' },
}
