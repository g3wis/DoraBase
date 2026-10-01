import type { ConnectionSettings, Database, SslMode } from '../../domain/config'
import { draftDepuisLaVariante, emptyDraft, emptyProxy, emptyTunnel } from './ConnectionDraft'

test('un tunnel neuf est SSH, sur le port 22', () => {
  const tunnel = emptyTunnel('ssh')
  expect(tunnel.localPort).toBeNull()
  expect(tunnel.proxy).toEqual({
    kind: 'ssh',
    bastionHost: '',
    // Le port de SSH : le seul champ préremplissable de cette sorte, parce qu'il est vrai
    // pour la quasi-totalité des bastions.
    bastionPort: '22',
    username: '',
    privateKeyPath: '',
  })
})

test('un proxy Cloud SQL neuf n’invente pas d’instance', () => {
  // Un seul champ depuis `06j` : le compte de service ne se saisit plus, donc il n'y a plus
  // qu'une chaîne vide à ne pas préremplir.
  expect(emptyProxy('cloud-sql')).toEqual({
    kind: 'cloud-sql',
    instanceConnectionName: '',
  })
})

test('un transfert Kubernetes neuf ne préremplit aucun de ses trois champs', () => {
  // **`default` comme espace de noms serait faux**, et c'est le seul des trois qui aurait pu
  // tenter : vide, `kubectl` emploie celui que le contexte déclare, alors qu'un `default` écrit
  // dans le champ l'écraserait. Un préremplissage qui change le comportement n'est pas une
  // commodité — c'est une décision prise à la place de l'utilisateur. Les deux autres n'ont pas de
  // valeur universelle du tout.
  expect(emptyProxy('kubernetes')).toEqual({
    kind: 'kubernetes',
    kubeconfig: '',
    namespace: '',
    resource: '',
  })
})

test('un brouillon neuf n’a pas de tunnel', () => {
  // Le panneau de `A2` s'ouvre replié et sans badge : un tunnel par défaut mettrait une
  // fausse déclaration sous les yeux de l'utilisateur à chaque ouverture.
  expect(emptyDraft().tunnel).toBeNull()
})

test('les trois sortes de proxy portent exactement leurs champs, et pas ceux des autres', () => {
  // C'est l'invariant que `05d` porte côté Rust et que ce brouillon doit refléter : un
  // brouillon Cloud SQL ne peut pas transporter un bastion, sinon `08e` devrait deviner
  // laquelle des sortes convertir.
  expect(Object.keys(emptyProxy('ssh')).sort()).toEqual([
    'bastionHost',
    'bastionPort',
    'kind',
    'privateKeyPath',
    'username',
  ])
  expect(Object.keys(emptyProxy('cloud-sql')).sort()).toEqual(['instanceConnectionName', 'kind'])
  expect(Object.keys(emptyProxy('kubernetes')).sort()).toEqual([
    'kind',
    'kubeconfig',
    'namespace',
    'resource',
  ])
})

test('un transfert Kubernetes enregistré revient en brouillon, absences comprises', () => {
  // **Les deux champs optionnels traversent dans les deux sens** : `null` côté modèle devient `''`
  // côté écran, et c'est ce qui permet au champ de rester vide plutôt que d'afficher « null ».
  // C'est la convention déjà appliquée au certificat d'autorité et à la base d'authentification.
  const variante: ConnectionSettings = {
    ...varianteEnregistree('disable'),
    tunnel: {
      localPort: null,
      proxy: {
        kind: 'kubernetes',
        kubeconfig: null,
        namespace: null,
        resource: 'svc/postgres',
      },
    },
  }
  const draft = draftDepuisLaVariante({ ...baseMongo('disable'), connection: variante }, variante)

  expect(draft.tunnel?.proxy).toEqual({
    kind: 'kubernetes',
    kubeconfig: '',
    namespace: '',
    resource: 'svc/postgres',
  })
  // Le port local **n'est pas reprisdu fichier** : il est attribué à l'ouverture, donc en afficher
  // un d'une session précédente serait afficher un port qui n'a plus cours.
  expect(draft.tunnel?.localPort).toBeNull()
})

test('un kubeconfig et un espace de noms enregistrés reviennent tels quels', () => {
  // Contrôle négatif du test précédent : sans lui, « les absences deviennent des chaînes vides »
  // passerait aussi si la conversion vidait *tout*.
  const variante: ConnectionSettings = {
    ...varianteEnregistree('disable'),
    tunnel: {
      localPort: null,
      proxy: {
        kind: 'kubernetes',
        kubeconfig: '~/.kube/prod',
        namespace: 'bases',
        resource: 'pod/postgres-0',
      },
    },
  }
  const draft = draftDepuisLaVariante({ ...baseMongo('disable'), connection: variante }, variante)
  expect(draft.tunnel?.proxy).toEqual({
    kind: 'kubernetes',
    // Le `~` revient **tel qu'il a été enregistré** : le développer ici afficherait un chemin
    // absolu que l'utilisateur n'a pas saisi, et le réenregistrer figerait un `HOME`.
    kubeconfig: '~/.kube/prod',
    namespace: 'bases',
    resource: 'pod/postgres-0',
  })
})

// --- Le mode SSL d'une connexion déjà enregistrée ---

/** Une variante enregistrée, dont seul le mode SSL nous intéresse ici. */
function varianteEnregistree(sslMode: SslMode): ConnectionSettings {
  return {
    host: 'localhost',
    port: 27017,
    defaultDatabase: 'atelier_ventes',
    username: 'lecture',
    password: null,
    sslMode,
    caCertificate: null,
    authDatabase: null,
    readOnly: false,
    reconnectOnStartup: false,
    tunnel: null,
  }
}

function baseMongo(sslMode: SslMode): Database {
  return {
    id: 'c-ventes',
    name: 'ventes',
    engine: 'mongodb',
    connection: varianteEnregistree(sslMode),
    consoles: [],
  } as unknown as Database
}

test('une connexion MongoDB enregistrée en « prefer » s’ouvre sur « require »', () => {
  // **Le mode lui était offert jusqu'au 26 août 2026, et son pilote le remplaçait par `require`
  // sans le dire.** Il ne figure plus dans la liste : sans ce report, la liste déroulante afficherait
  // un champ **vide** — sa valeur n'étant aucune de ses options —, ce qui est le piège du sélecteur
  // contrôlé déjà rencontré sur le projet. `require` est ce qui s'appliquait déjà ; l'écran le dit.
  const draft = draftDepuisLaVariante(baseMongo('prefer'), varianteEnregistree('prefer'))
  expect(draft.sslMode).toBe('require')
})

test('un mode que le moteur exprime est repris tel quel', () => {
  // Contrôle négatif : sans lui, le report se lirait « toute connexion s’ouvre sur require ».
  const draft = draftDepuisLaVariante(baseMongo('disable'), varianteEnregistree('disable'))
  expect(draft.sslMode).toBe('disable')
})

test('une connexion enregistrée sans base d’authentification garde le champ vide', () => {
  // **Le préremplissage ne vaut que pour un brouillon neuf.** Écrire `admin` ici changerait le
  // comportement d'une connexion qui marche, au premier enregistrement — et sans que personne l'ait
  // demandé.
  const draft = draftDepuisLaVariante(baseMongo('disable'), varianteEnregistree('disable'))
  expect(draft.sslMode).toBe('disable')
  expect(draft.authDatabase).toBe('')
})

test('un brouillon neuf porte « admin »', () => {
  expect(emptyDraft().authDatabase).toBe('admin')
})
