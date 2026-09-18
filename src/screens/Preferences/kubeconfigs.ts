/**
 * Ce que la section « Connexions » de `A10` calcule (`API-70`), sans rien rendre.
 *
 * **Pur, et séparé du composant** : la question « qui se sert de cette déclaration ? » décide d'un
 * bouton désactivé et de sa raison, donc elle mérite d'être vérifiable seule — et elle est la moitié
 * écran d'un refus que le cœur prononce aussi. Les deux gardent deux chemins différents : l'écran
 * empêche le geste, le Rust tient la garantie quand la demande ne vient pas de l'écran.
 */
import type {
  ConnectionSettings,
  KubeconfigDeclaration,
  KubeconfigId,
  Kubeconfigs,
  ManagedInstance,
  Project,
} from '../../domain/config'

/**
 * Les connexions et instances qui référencent cette déclaration, nommées.
 *
 * **Des étiquettes, jamais un compte** : un nombre dit qu'il y a un obstacle, une liste dit lequel —
 * et c'est la liste qu'il faut pour aller changer ce qui gêne. Les instances managées y figurent
 * parce qu'elles portent les mêmes réglages de connexion, donc le même proxy : les omettre ferait un
 * bouton actif qui échoue, c'est-à-dire le défaut que le grisé existe pour éviter.
 */
export function utilisationsDe(
  reference: KubeconfigId,
  projects: readonly Project[],
  instances: readonly ManagedInstance[],
): string[] {
  const etiquettes: string[] = []
  for (const projet of projects) {
    for (const base of projet.databases) {
      if (referenceDe(base.connection) === reference) {
        etiquettes.push(`${projet.name} › ${base.name} (${base.environment})`)
      }
    }
  }
  for (const instance of instances) {
    if (referenceDe(instance.connection) === reference) {
      etiquettes.push(instance.label || instance.id)
    }
  }
  return etiquettes
}

/**
 * La référence de kubeconfig d'une connexion, s'il y en a une.
 *
 * **`ConnectionSettings` et non une forme écrite ici** : le `kind` discrimine l'union `Proxy`, donc
 * TypeScript rend `kubeconfig` sans transtypage — et une quatrième sorte de proxy fera échouer la
 * compilation là où il faudra décider si elle en porte un, comme le `match` exhaustif côté Rust.
 */
function referenceDe(reglages: ConnectionSettings): KubeconfigId | null {
  const proxy = reglages.tunnel?.proxy
  if (proxy?.kind !== 'kubernetes') return null
  return proxy.kubeconfig ?? null
}

/** Retire une déclaration, et le défaut avec si c'était lui. */
export function sansLaDeclaration(kubeconfigs: Kubeconfigs, reference: KubeconfigId): Kubeconfigs {
  const declarations = (kubeconfigs.declarations ?? []).filter(
    (declaration) => declaration.id !== reference,
  )
  return {
    declarations,
    // **Le défaut part avec sa déclaration**, sinon il désignerait le vide — ce que `valider`
    // refuserait côté Rust, donc un retrait qui échouerait pour une raison que personne n'a demandée.
    default: kubeconfigs.default === reference ? null : kubeconfigs.default,
  }
}

/** Renomme une déclaration. L'identifiant ne bouge pas : c'est ce qui tient les références. */
export function avecLeLibelle(
  kubeconfigs: Kubeconfigs,
  reference: KubeconfigId,
  libelle: string,
): Kubeconfigs {
  return {
    ...kubeconfigs,
    declarations: (kubeconfigs.declarations ?? []).map((declaration) =>
      declaration.id === reference ? { ...declaration, label: libelle } : declaration,
    ),
  }
}

/**
 * Déplace une déclaration : le chemin change, l'identifiant non.
 *
 * **C'est tout l'achat de la référence** — une connexion n'a rien à rouvrir pour suivre un fichier
 * qui a bougé.
 */
export function avecLeChemin(
  kubeconfigs: Kubeconfigs,
  reference: KubeconfigId,
  chemin: string,
): Kubeconfigs {
  return {
    ...kubeconfigs,
    declarations: (kubeconfigs.declarations ?? []).map((declaration) =>
      declaration.id === reference ? { ...declaration, path: chemin } : declaration,
    ),
  }
}

/** Pose — ou retire — le kubeconfig qui préremplit une connexion neuve. */
export function avecLeDefaut(
  kubeconfigs: Kubeconfigs,
  reference: KubeconfigId | null,
): Kubeconfigs {
  return { ...kubeconfigs, default: reference }
}

/** Les déclarations, jamais `undefined` : le champ est optionnel dans la projection. */
export function declarationsDe(kubeconfigs: Kubeconfigs): readonly KubeconfigDeclaration[] {
  return kubeconfigs.declarations ?? []
}
