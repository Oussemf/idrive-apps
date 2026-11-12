# Integration MGU : developpement experimental

**Pas de binaire voiture valide, pas de release prete a installer.**
Le Store peut construire le lanceur ID7, pas fournir automatiquement
un navigateur compatible. L'ajout de cette source ne rend pas les videos
fonctionnelles sans le compagnon.

## Prerequis

- MGU avec OAP et Store deja operationnels, sous la responsabilite du proprietaire.
- Renderer **natif mgu-render/1**, pixmaps et foreground gate. Les anciens
  renderers ne proposant que le protocole upstream sont refuses.
- Routage tactile / controller gate selon le renderer pour les commandes.
- `mgu-uplink` configure dans le Store, application autorisee a acceder
  au reseau. Wi-Fi du telephone ou autre uplink choisi dans le Store.
- Executable Chromium/Electron compatible avec le firmware, valide sur
  banc, lance sous **le meme UID** que l'app. Le depot ne le fournit pas.
- Pas de execution root, pas de `--no-sandbox`, pas de bibliotheques BMW
  copiees dans ce depot.

## Build du lanceur

Prerequis de build : Python >= 3.8 et Node.js.
Le Store fournit lui-meme `oap-sdk` depuis le vehicule. En local, seule
la version preview est possible sans ce SDK :

```powershell
python tools\build_mgu.py oussem_youtube --preview-only
```

Avec un SDK provenant legalement de votre propre unite, dans le dossier
ignore `oap-sdk`, le meme outil sans `--preview-only` genere les archives.
Le wrapper retire le SDK des archives finales et ajoute `mguInternet`.
**Ne jamais publier le SDK ni les archives intermediaires d'un build.**

ID7 uniquement pour le paquet actuel. Le runtime GPU emploie les zones
negociees et non une resolution ID7 codee en dur, mais cela ne valide
pas l'interface OAP d'ID8.

## Configuration du compagnon (apres validation materielle)

Le lanceur lit `runtime.json` dans son propre dossier `data`. Exemple
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
La distribution de ce compagnon en outil Store reste a faire apres
avoir identifie un runtime effectivement compatible.

## Securite et cycle de vie

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
Il n'existe pas d'option pour desactiver ce blocage en mode MGU.

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

- `Runtime unavailable` : executable/projet non configure ou inexistant.
- `No valid speed signal` : ne pas contourner ; verifier subscription/permissions.
- `Store proxy` / bail absent : autoriser l'app et connecter l'uplink dans le Store.
- Renderer refuse : verifier `mgu-render/1`, pixmaps et foreground gate.
- Video non lisible : codecs, politique d'integration, connexion, restrictions
  age/region ou navigateur non accepte ; ne pas contourner ces restrictions.
- Pas de son : le backend et l'audio-focus BMW restent a integrer.

Arret/retrait : quitter via BACK/HOME, retirer le lanceur depuis le Store.
Le projet ne modifie aucun fichier du firmware, service systeme ou route.
Retirer manuellement les sources/profil du compagnon si deposes pour un banc.
