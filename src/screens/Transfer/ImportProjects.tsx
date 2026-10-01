import { useId, useState } from 'react'
import type { FolderOutcome, ImportReport, ImportSelection } from '../../domain/arbre'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import styles from './Transfer.module.css'
import { messageDe } from './transferCommands'

type ImportProjectsProps = {
  onClose: () => void
  /** Ouvre le sélecteur de source **natif** et rend le chemin choisi, ou `null`. */
  onChoisirFichier: () => Promise<string | null>
  onInspecter: (fichier: string) => Promise<ImportReport>
  onImporter: (fichier: string, selection: ImportSelection | null) => Promise<ImportReport>
}

/**
 * La modale d'import (`API-30`, portée sur les dossiers par #169).
 *
 * # Le fichier est **inspecté avant** d'être proposé
 *
 * L'inspection précède la confirmation, comme celle d'un dump : c'est elle qui refuse un fichier
 * d'une autre sorte ou d'une version trop récente, et la modale doit pouvoir le dire avant de
 * proposer d'importer. Elle dit aussi, dossier de premier niveau par dossier, **ce qui arrivera et ce
 * qui n'arrivera pas** — un import amputé en silence se lirait comme un import complet. Les
 * connexions que le fichier range à la racine ont leur propre ligne, qui se retient comme les autres.
 *
 * # L'aperçu et l'écriture viennent du même calcul
 *
 * Les deux rapports sortent de la même fonction du cœur, et le versement est **recalculé** au moment
 * d'écrire, sur la configuration telle qu'elle est alors. Ce que la modale montre est donc un aperçu
 * et non un plan : rien de ce qu'elle affiche ne décide de ce qui s'écrit.
 */
export function ImportProjects({
  onClose,
  onChoisirFichier,
  onInspecter,
  onImporter,
}: ImportProjectsProps) {
  const t = useT()
  const [fichier, setFichier] = useState<string | null>(null)
  const [apercu, setApercu] = useState<ImportReport | null>(null)
  const [ecartes, setEcartes] = useState<readonly string[]>([])
  const [resultat, setResultat] = useState<ImportReport | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  /**
   * Les **écartés** et non les retenus, et c'est ce qui rend le défaut juste : un fichier fraîchement
   * inspecté a tous ses dossiers cochés, et une liste de retenus aurait dû être remplie à l'arrivée
   * du rapport — donc dans un effet, qui se serait rejoué à chaque rendu de l'hôte.
   */
  const retenu = (cle: string) => !ecartes.includes(cle)

  async function choisir() {
    setErreur(null)
    const choisi = await onChoisirFichier()
    if (!choisi) return
    setFichier(choisi)
    setApercu(null)
    setEcartes([])
    try {
      setApercu(await onInspecter(choisi))
    } catch (cause) {
      setErreur(messageDe(cause))
    }
  }

  async function importer() {
    if (!fichier || !apercu) return
    const retenus = apercu.folders.filter(
      (sort) => sort.verdict.kind !== 'rejected' && retenu(cleDe(sort)),
    )
    const selection: ImportSelection = {
      folders: retenus.flatMap((sort) => (sort.folder === null ? [] : [sort.folder])),
      rootConnections: retenus.some((sort) => sort.folder === null),
    }
    try {
      setResultat(await onImporter(fichier, selection))
    } catch (cause) {
      setErreur(messageDe(cause))
    }
  }

  const rapport = resultat ?? apercu
  const importables = apercu
    ? apercu.folders.filter((sort) => sort.verdict.kind !== 'rejected' && retenu(cleDe(sort)))
        .length
    : 0

  return (
    <Modal
      title={t('transfer.import.title')}
      /* **`ul`, pas `save`** (17 septembre 2026, à la demande : « do not use a save icon for an
         import feature »). Une disquette dit « enregistrer », pas « importer » — et elle le disait
         déjà dans la modale d'import de dump, d'où celle-ci l'avait reprise. `ul` et `dl` sont un
         **couple** : même sol, une flèche qui descend vers le disque pour l'export, une qui en
         remonte pour l'import. C'est l'appariement qui les rend lisibles, et c'est pourquoi les
         deux gestes ne peuvent pas partager un glyphe ni en emprunter un qui dit autre chose. */
      icon="ul"
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>
            {t('transfer.close')}
          </Button>
          {resultat === null &&
            (apercu === null ? (
              <Button onClick={choisir}>{t('transfer.import.choose')}</Button>
            ) : (
              <Button
                onClick={importer}
                // Un bouton inerte mais actif se lit comme une panne : tout décocher le désactive,
                // avec sa raison.
                aria-disabled={importables === 0 || undefined}
                title={importables === 0 ? t('transfer.import.nothingSelected') : undefined}
              >
                {t('transfer.import.apply', { count: importables })}
              </Button>
            ))}
        </div>
      }
    >
      <div className={styles.body}>
        {fichier === null && <p className={styles.explication}>{t('transfer.import.what')}</p>}
        {fichier !== null && <p className={styles.chemin}>{fichier}</p>}

        {erreur !== null && <p className={styles.echec}>{erreur}</p>}

        {rapport !== null && rapport.secrets === 'embedded' && (
          <p className={styles.avertissement}>{t('transfer.import.carriesPasswords')}</p>
        )}

        {rapport !== null && rapport.folders.length === 0 && (
          <p className={styles.reserve}>{t('transfer.import.emptyFile')}</p>
        )}

        {rapport !== null && rapport.folders.length > 0 && (
          <div className={styles.projets}>
            {rapport.folders.map((sort) => (
              <Ligne
                key={cleDe(sort)}
                sort={sort}
                fini={resultat !== null}
                retenu={retenu(cleDe(sort))}
                onRetenu={(garde) =>
                  setEcartes((precedents) =>
                    garde
                      ? precedents.filter((cle) => cle !== cleDe(sort))
                      : [...precedents, cleDe(sort)],
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Une ligne du rapport : le dossier, son sort, et ce qu'il apporte ou n'apporte pas. */
function Ligne({
  sort,
  fini,
  retenu,
  onRetenu,
}: {
  sort: FolderOutcome
  /** L'import a eu lieu : la ligne décrit ce qui s'est passé, et il n'y a plus rien à cocher. */
  fini: boolean
  retenu: boolean
  onRetenu: (retenu: boolean) => void
}) {
  const t = useT()
  const refuse = sort.verdict.kind === 'rejected'
  const nom = sort.folder ?? t('transfer.import.rootConnections')
  /* La ligne de la racine ne se dit pas « dossier existant » : la racine n'est pas un dossier. */
  const verdict =
    sort.folder === null && sort.verdict.kind === 'merged'
      ? t('transfer.import.verdict.rootMerged')
      : t(`transfer.import.verdict.${sort.verdict.kind}`)
  /**
   * L'identifiant qui apparie la case et son nom.
   *
   * `useId` et non le nom du dossier : celui-ci accepte n'importe quel caractère, et un identifiant
   * HTML dérivé d'une saisie libre peut collisionner ou être invalide. C'est React qui garantit
   * l'unicité.
   */
  const identifiant = useId()

  /*
   * **Une case native, et le `<label>` qui la nomme.**
   *
   * Le dépôt bannit le composant natif pour les *listes déroulantes*, dont le maison remplace
   * l'apparence ; une case à cocher n'a rien de tel à remplacer — c'est un carré et une coche, que
   * le système dessine correctement, au thème près que `color-scheme` lui donne déjà. C'est le même
   * arbitrage que le curseur des préférences et que le calendrier des filtres. Un
   * `<button role="checkbox">` aurait redit ce que la plateforme sait faire, en perdant
   * l'appariement au libellé — et Biome le refuse, avec raison.
   *
   * **Aucune case sur un dossier refusé, plutôt qu'une case grisée.** Un contrôle désactivé annonce
   * « pas maintenant » ; celui-ci ne pourra jamais retenir ce dossier-là. Sa raison est déjà
   * **écrite** sur la ligne, ce qui vaut mieux qu'une infobulle sur un contrôle mort — c'est
   * l'arbitrage du bouton « Valider » d'une transaction abandonnée.
   */
  return (
    <div className={styles.projet}>
      {!fini && !refuse && (
        <input
          type="checkbox"
          id={identifiant}
          className={styles.case}
          checked={retenu}
          onChange={(evenement) => onRetenu(evenement.target.checked)}
        />
      )}
      <div className={styles.projetTexte}>
        {fini || refuse ? (
          <span className={styles.projetNom}>{nom}</span>
        ) : (
          <label className={styles.projetNom} htmlFor={identifiant}>
            {nom}
          </label>
        )}
        <span className={styles.detail}>
          {verdict}
          {/* Ce qui **arrive**. Les trois comptes ensemble, pour tenir sur une ligne : un fichier de
              trente dossiers ferait sinon trente cartes de six lignes. */}
          {!refuse &&
            sort.verdict.kind !== 'skipped' &&
            ` · ${t('transfer.import.brings', {
              folders: sort.foldersAdded.length,
              connections: sort.connectionsAdded.length,
              consoles: sort.consolesAdded.length,
            })}`}
        </span>

        {/* Ce qui **n'arrive pas**, et pourquoi. Chaque ligne ne paraît que s'il y a de quoi la
            remplir : une réserve vide se lirait comme une réserve. La liste elle-même est dans
            l'infobulle — un nom par connexion dans une modale de 330 px serait illisible, et le
            compte dit d'abord s'il y a quelque chose à regarder. */}
        {sort.connectionsKept.length > 0 && (
          <span className={styles.reserve} title={sort.connectionsKept.join('\n')}>
            {t('transfer.import.connectionsKept', { count: sort.connectionsKept.length })}
          </span>
        )}
        {sort.consolesKept.length > 0 && (
          <span className={styles.reserve} title={sort.consolesKept.join('\n')}>
            {t('transfer.import.consolesKept', { count: sort.consolesKept.length })}
          </span>
        )}
        {sort.foldersKept.length > 0 && (
          <span className={styles.reserve} title={sort.foldersKept.join('\n')}>
            {t('transfer.import.foldersKept', { count: sort.foldersKept.length })}
          </span>
        )}
        {/* **Ce que le fichier portait et qui n'est pas créé** (#108) : un contenant dont toutes les
            connexions sont déjà ici. L'infobulle nomme les dossiers. */}
        {sort.foldersOmitted.length > 0 && (
          <span className={styles.reserve} title={sort.foldersOmitted.join('\n')}>
            {t('transfer.import.foldersOmitted', { count: sort.foldersOmitted.length })}
          </span>
        )}
        {/* **La seule chose qu'un import change à ce qui était déjà là** (#169) : la lecture seule
            fusionne en « locale OU fichier », jamais affaiblie. Une réserve, parce qu'elle ferme les
            connexions ouvertes de ces dossiers, et l'infobulle les nomme. */}
        {sort.readOnlyFromFile.length > 0 && (
          <span className={styles.reserve} title={sort.readOnlyFromFile.join('\n')}>
            {t('transfer.import.readOnlyFromFile', { count: sort.readOnlyFromFile.length })}
          </span>
        )}
        {sort.passwordsMissing.length > 0 && (
          <span className={styles.reserve} title={sort.passwordsMissing.join('\n')}>
            {t('transfer.import.passwordsMissing', { count: sort.passwordsMissing.length })}
          </span>
        )}
        {sort.passwordsStored.length > 0 && (
          <span className={styles.detail} title={sort.passwordsStored.join('\n')}>
            {t('transfer.import.passwordsStored', { count: sort.passwordsStored.length })}
          </span>
        )}
        {sort.localPaths.length > 0 && (
          <span className={styles.reserve} title={sort.localPaths.join('\n')}>
            {t('transfer.import.localPaths', { count: sort.localPaths.length })}
          </span>
        )}
        {/* **Un détail et une réserve** (`API-75`), et le partage est celui des mots de passe
            juste au-dessus : ce qui *arrive* se dit en neutre, ce qui est *gardé* en réserve —
            c'est la seule des deux qui demande de savoir que le fichier portait autre chose. */}
        {sort.valueLabelsAdded.length > 0 && (
          <span className={styles.detail} title={sort.valueLabelsAdded.join('\n')}>
            {t('transfer.import.valueLabelsAdded', { count: sort.valueLabelsAdded.length })}
          </span>
        )}
        {sort.valueLabelsKept.length > 0 && (
          <span className={styles.reserve} title={sort.valueLabelsKept.join('\n')}>
            {t('transfer.import.valueLabelsKept', { count: sort.valueLabelsKept.length })}
          </span>
        )}
        {/* **En `refus` et non en `reserve`** (`API-70`) : une connexion dont le kubeconfig n'est
            déclaré nulle part dans le fichier **n'ouvrira pas**, là où un chemin local peut très
            bien exister sur cette machine. Un import amputé en silence se lirait comme un import
            complet, ce qui est le pire défaut que ce geste puisse avoir. */}
        {sort.kubeconfigsMissing.length > 0 && (
          <span className={styles.refus} title={sort.kubeconfigsMissing.join('\n')}>
            {t('transfer.import.kubeconfigsMissing', { count: sort.kubeconfigsMissing.length })}
          </span>
        )}
        {sort.connectionsRejected.length > 0 && (
          <span className={styles.refus} title={sort.connectionsRejected.join('\n')}>
            {t('transfer.import.connectionsRejected', { count: sort.connectionsRejected.length })}
          </span>
        )}
        {sort.verdict.kind === 'rejected' && (
          <span className={styles.refus}>{sort.verdict.reason}</span>
        )}
      </div>
    </div>
  )
}

/**
 * La clé d'une ligne du rapport : le nom du dossier de premier niveau, ou la chaîne vide pour la
 * ligne des connexions à la racine.
 *
 * **La chaîne vide ne peut pas être le nom d'un dossier** — `FolderTree::valider` refuse un nom vide
 * ou blanc —, donc elle ne peut pas désigner deux lignes. Un libellé traduit servirait mal de clé :
 * il changerait avec la langue, et une langue changée pendant que la modale est ouverte
 * recocherait la ligne.
 */
function cleDe(sort: FolderOutcome): string {
  return sort.folder ?? ''
}
