import { useEffect, useMemo, useState } from 'react'
import type { FolderTree } from '../../domain/config'
import type { DumpAvailability, DumpTransport, Inspection } from '../../domain/dump'
import { useT } from '../../i18n/LanguageContext'
import { Button } from '../../ui/Button/Button'
import { Modal } from '../../ui/Modal/Modal'
import { cibleUnique } from './cibleUnique'
import styles from './Dump.module.css'
import * as pont from './dumpCommands'
import { ExportDump, messageDe } from './ExportDump'
import { ImportDump } from './ImportDump'

export type SensDuDump = 'export' | 'import'

type DumpDialogsProps = {
  sens: SensDuDump
  arbre: FolderTree
  onClose: () => void
  /** Le pont IPC, injecté pour les tests — voir `dumpCommands.ts`. */
  commandes?: typeof pont
}

/**
 * Ce que `⇧⌘E` et `⇧⌘I` ouvrent : la modale d'export ou celle d'import, sur la base que la
 * configuration désigne sans ambiguïté.
 *
 * **La résolution de la cible est le point délicat**, et elle est traitée dans
 * `cibleUnique.ts` : le menu natif n'émet qu'un identifiant d'item, et l'app n'a pas encore
 * de sélection d'arbre (`A4` n'est pas assemblé en écran). Sans cible unique, la modale le
 * **dit** plutôt que de choisir — se tromper de base à l'import écrirait dans la mauvaise.
 */
export function DumpDialogs({ sens, arbre, onClose, commandes = pont }: DumpDialogsProps) {
  const t = useT()
  // `useMemo` et non un appel direct : la cible est l'objet dont dépend l'effet ci-dessous,
  // et la recalculer à chaque rendu relancerait la demande de verdict en boucle.
  const cible = useMemo(() => cibleUnique(arbre), [arbre])
  const [availability, setAvailability] = useState<DumpAvailability | null>(null)
  const [transport, setTransport] = useState<DumpTransport | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [octets, setOctets] = useState(0)
  const [fichier, setFichier] = useState<string | undefined>(undefined)
  const [inspection, setInspection] = useState<Inspection | null>(null)

  // Le verdict est demandé à l'ouverture : la modale doit pouvoir dire « pg_dump est
  // introuvable » avant que l'utilisateur choisisse un fichier pour rien.
  useEffect(() => {
    if (!cible) return
    let vivant = true
    commandes
      .dumpAvailability(cible.request, sens)
      .then((verdict) => {
        if (!vivant) return
        setAvailability(verdict.availability)
        setTransport(verdict.transport)
      })
      .catch((cause) => {
        if (vivant) setErreur(messageDe(cause))
      })
    return () => {
      vivant = false
    }
  }, [cible, sens, commandes])

  // La progression n'est écoutée que pendant un export : l'import n'en émet pas.
  useEffect(() => {
    if (sens !== 'export') return
    return commandes.ecouterLaProgression(setOctets)
  }, [sens, commandes])

  if (!cible) {
    return (
      <Modal
        title={t('dump.noTarget.title')}
        icon="warn"
        onClose={onClose}
        footer={
          <div className={styles.footer}>
            <Button variant="secondary" onClick={onClose}>
              {t('dump.export.close')}
            </Button>
          </div>
        }
      >
        <div className={styles.body}>
          <p className={styles.explication}>{t('dump.noTarget.text')}</p>
        </div>
      </Modal>
    )
  }

  if (erreur) {
    return (
      <Modal
        title={t('dump.availabilityFailed')}
        icon="warn"
        onClose={onClose}
        footer={
          <div className={styles.footer}>
            <Button variant="secondary" onClick={onClose}>
              {t('dump.export.close')}
            </Button>
          </div>
        }
      >
        <div className={styles.body}>
          <p className={styles.echec}>{erreur}</p>
        </div>
      </Modal>
    )
  }

  const { nommee } = cible

  if (sens === 'export') {
    return (
      <ExportDump
        availability={availability}
        transport={transport}
        cible={nommee}
        octetsEcrits={octets}
        onClose={onClose}
        onChoisirFichier={() => commandes.choisirDestination(nommee.base)}
        onExporter={(chemin) => commandes.startExport({ ...cible.request, file: chemin })}
        onAnnuler={() => {
          void commandes.cancelExport(cible.request.key)
        }}
      />
    )
  }

  return (
    <ImportDump
      availability={availability}
      transport={transport}
      inspection={inspection}
      cible={nommee}
      fichier={fichier}
      onClose={onClose}
      onChoisirFichier={async () => {
        const choisi = await commandes.choisirSource()
        if (!choisi) return null
        setFichier(choisi)
        // L'inspection **précède** la confirmation : c'est elle qui refuse un fichier
        // tronqué, et la modale doit pouvoir le dire avant de proposer d'importer.
        setInspection(await commandes.inspectDump({ ...cible.request, file: choisi }))
        return choisi
      }}
      onImporter={(chemin) => commandes.startImport({ ...cible.request, file: chemin })}
    />
  )
}
