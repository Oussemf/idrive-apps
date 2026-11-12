# Integration MGU : developpement experimental

**Compagnon experimental disponible sur main et via le catalogue Releases.**
Il contient un navigateur et ses dependances prives, avec des tests sur
userland glibc 2.27. Il n'est pas certifie sur toutes les variantes MGU.

## Installation depuis MGU Store 0.9.39

1. Dans Sources, conserver `Oussemf/idrive-apps`, canal **main**.
2. Actualiser le catalogue.
3. Installer **YouTube browser companion (experimental)**.
4. Mettre a jour **YouTube (experimental)** en version **0.2.2**.
5. Ouvrir l'app, puis choisir une session de validation avec le vehicule stationne.

Autre entree possible dans Sources, en HTTPS :
`https://github.com/Oussemf/idrive-apps/releases/download/catalog/catalog.json`

Le catalogue versionne les deux composants et leurs SHA-256. Le Store
les telecharge et verifie les fichiers. Le lanceur utilise automatiquement
le compagnon installe : aucun JSON, terminal ni SSH n'est necessaire.
Le compagnon est un outil amovible sans service permanent. Son affichage
X11 prive n'ecoute pas le reseau et ne remplace pas le compositor du MGU.
Le moteur Chromium est decompresse dans le cache prive de l'app au premier
lancement, avec verification SHA-256. Prevoir environ 250 Mo supplementaires
dans les donnees de l'app, en plus du compagnon installe et des sauvegardes.
La preparation initiale peut retarder l'ouverture de l'interface.

## Prerequis

- MGU avec OAP et Store deja operationnels, sous la responsabilite du proprietaire.
- Renderer **natif mgu-render/1**, pixmaps et foreground gate. Les anciens
  renderers ne proposant que le protocole upstream sont refuses.
- Routage tactile / controller gate selon le renderer pour les commandes.
- `mgu-uplink` configure dans le Store, application autorisee a acceder
  au reseau. Wi-Fi du telephone ou autre uplink choisi dans le Store.
- Compagnon `oussem-browser`, lance sous **le meme UID** que l'app.
  La release est testee avec une glibc systeme 2.27 sans utiliser ses
  bibliotheques pour Chromium ; les contraintes du noyau restent a verifier.
- Pas de execution root, pas de `--no-sandbox`, pas de bibliotheques BMW
  copiees dans ce depot.

## Build du lanceur

Prerequis de build : Python >= 3.8 et Node.js.
Le Store fournit lui-meme `oap-sdk` depuis le vehicule. Une preview locale
ne produit pas de paquet installable :

```powershell
python tools\build_mgu.py oussem_youtube --preview-only
```

Pour une archive publique sans SDK, utiliser
`python tools/build_mgu.py oussem_youtube --sdk-free`.
Le Store injecte le SDK provenant de son propre donneur a l'installation.
Le wrapper ajoute `mguInternet`. Un build avec SDK local reste possible,
mais le SDK est retire des archives finales.
**Ne jamais publier le SDK ni les archives intermediaires d'un build.**

ID7 uniquement pour le paquet actuel. Le runtime GPU emploie les zones
negociees et non une resolution ID7 codee en dur, mais cela ne valide
pas l'interface OAP d'ID8.

## Configuration du compagnon (optionnelle pour developpeurs)

Sans fichier, le lanceur detecte le composant Store. Pour remplacer cette
selection, il lit `runtime.json` dans son propre dossier `data`. Exemple
de structure, avec des chemins a adapter (ne pas committer ce fichier) :

```json
{
  "executable": "/opt/validated-chromium/electron",
  "project": "/opt/idrive-apps",
  "youtubeApiKey": "<facultatif>"
}
```

Il faut les sources du projet et le runtime approprie, pas les
`node_modules` Windows. Le code du runtime n'a pas de dependance npm de
production : Electron fournit Node/Chromium, le client renderer est
vendore. Restreindre les droits du fichier a l'UID de l'app.
Le lanceur ne telecharge ni n'installe de programmes privilegies.
Le composant fourni dans Releases embarque ces sources et son executable.
Ne pas utiliser les chemins d'exemple pour l'installation normale.

## Securite et cycle de vie

### Session de validation dans le garage

Pour se concentrer sur la lecture, la recherche et les performances sans
dependre du signal de vitesse, utiliser **Garage test - original UI
(vehicle parked)** ou **Garage test - YouTube TV (vehicle parked)** dans
le menu du lanceur. Le vehicule doit rester stationne dans le garage.
Ces boutons autorisent uniquement la session courante, sans reglage persistant.

Le lanceur transmet `--garage-test` au compagnon et publie `garageTest: true`
dans son heartbeat. Les deux autorisations sont necessaires ; un fichier
seul ne desactive pas les controles du runtime normal. Le statut indique
explicitement **TEST GARAGE - vitesse non verifiee** : il n'affirme jamais
que le vehicule est immobile.

Les limites de fraicheur du heartbeat, le premier plan HMI et la disponibilite
du renderer restent obligatoires. Sortie, popup ou perte de focus annulent
la session dans le lanceur et terminent le compagnon. Revenir a l'app ne
reactive pas ce mode ; il faut choisir a nouveau un bouton Garage test.
Les restrictions video d'origine du vehicule ne sont pas modifiees.
Le mode garage et le compagnon navigateur sont deux mecanismes distincts.

### Fonctionnement normal (hors session garage)

Le signal lu est `Vehicle2.statusCarSpeed2.speedVehicleCentreOfGravity`,
facteur 1/64 km/h. `65535`, negatif, fractionnaire ou absent est invalide.
Lecture autorisee seulement si :

- vitesse **exactement 0**, echantillon datant d'au plus 5 s ;
- ecran RUNTIME visible et non recouvert ;
- heartbeat atomique datant d'au plus 2,5 s, jamais dans le futur ;
- renderer natif disponible et app au premier plan.

Le lanceur publie toutes les 500 ms, relit la vitesse toutes les 1 s ;
le compagnon controle toutes les 200 ms. Ce sont des budgets logiciels,
pas une certification temps reel. Mouvement ou perte du signal :
le compagnon detruit le lecteur et le lanceur termine le processus.
La session garage decrite ci-dessus est l'unique exception de developpement.

Ce controle ne verifie pas le rapport P ni le frein de stationnement.
N'utiliser qu'apres stationnement effectif, jamais dans un embouteillage.
Conserver toutes les restrictions video d'origine du vehicule.

Commandes du prototype :

- Tourner : focus suivant/precedent en UI originale ; droite/gauche dans TV.
- Appuyer : Entree.
- Pousser haut/bas/droite : fleches.
- Pousser longtemps vers le haut : plein ecran.
- Pousser a gauche : retour au client depuis TV ; Echap dans le client.
- BACK/HOME du HMI : quittent l'app, sans interception.

Les correspondances CCU et les interrupteurs HMI doivent etre verifies
sur chaque variante avant un essai utilisateur.

## Diagnostic

- `Setup incomplete: runtime.json is missing.` : le fichier de configuration
  manque dans le dossier data de l'app. L'ancien message `Runtime unavailable:
  ENOENT ... open '/var/opt/public/oap/...'` correspond a ce cas.
  Toutes les options utilisent le meme compagnon, donc echouent de la meme facon.
  **Ce n'est pas une panne YouTube, reseau ou GPU** : le navigateur n'a pas
  encore ete lance. Creer seulement le JSON ne suffit pas sans executable
  et sources compatibles installes ; les chemins d'exemple ne sont pas
  des programmes livres par les anciennes versions du depot. Depuis 0.2.0,
  installer le compagnon publie et supprimer seulement une ancienne
  configuration manuelle incorrecte, si vous en aviez cree une.
- `Install YouTube browser companion in the Store.` : mettre a jour la
  source via Releases, installer l'outil `oussem-browser` puis relancer.
  Les anciennes versions 0.1.x ne detectent pas le compagnon automatiquement.
- `Cannot read runtime.json` : verifier les droits de lecture du fichier.
- `Invalid runtime.json configuration.` : JSON invalide ou chemins absolus absents.
- `Configured browser executable is unavailable.` : executable configure absent.
- `Configured browser project is unavailable.` : sources ou runtime/main.js absents.
- Les details techniques et le chemin complet restent dans le journal de
  l'app (`<id>.log`, dans son dossier data). L'ecran donne deux messages
  courts pour eviter de tronquer l'erreur avec un long chemin.
- `No valid speed signal` : ne pas contourner ; verifier subscription/permissions.
- `Store proxy` / bail absent : autoriser l'app et connecter l'uplink dans le Store.
- Renderer refuse : verifier `mgu-render/1`, pixmaps et foreground gate.
- Video non lisible : codecs, politique d'integration, connexion, restrictions
  age/region ou navigateur non accepte ; ne pas contourner ces restrictions.
- Pas de son : le backend et l'audio-focus BMW restent a integrer.

Arret/retrait : quitter via BACK/HOME, retirer le lanceur depuis le Store.
Le projet ne modifie aucun fichier du firmware, service systeme ou route.
Retirer manuellement les sources/profil du compagnon si deposes pour un banc.
