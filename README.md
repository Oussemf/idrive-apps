# idrive-apps

Petites applications pour BMW MGU iDrive 7/8. Premiere application :
**YouTube**, avec interface originale ou navigateur dedie a YouTube TV.
Projet independant, GPL-3.0-or-later, non affilie a BMW, Google ou YouTube.

> **Prototype experimental, pas une application validee sur voiture.**
> Le lecteur officiel fonctionne dans le runtime de developpement Electron ;
> le mode TV est soumis au refus du navigateur par YouTube.
> Le lanceur OAP ID7, le pont GPU et un compagnon Chromium installable via
> le catalogue Releases sont fournis. Le compagnon embarque ses bibliotheques,
> sans remplacer celles du MGU ; la compatibilite materielle reste a valider.
> **ID8 n'est pas encore installable** : le kit de reference
> produit uniquement les descriptions HMI ID7. Ne pas installer Electron
> standard sur une voiture en supposant qu'il est compatible.

## Les deux approches

| | Interface originale | Navigateur encapsule |
|---|---|---|
| Interface | HTML/CSS originale, gros boutons, clavier/rotatif/tactile | Site officiel `https://www.youtube.com/tv`, en navigation principale |
| Recherche | YouTube Data API v3, cle personnelle necessaire | Recherche du site, sans cle API du projet |
| Lecture | Lecteur iframe officiel YouTube, pas d'extraction des flux | Lecteur et connexion du site |
| Sans cle API | Ouvrir une URL ou un identifiant video | Oui |
| Plein ecran | Bouton / F11 / Echap | F11, bouton du lecteur, Echap |
| Compte | Pas d'OAuth natif implemente ; politique du lecteur embarque | Connexion proposee par YouTube, selon acceptation du navigateur |
| Limites | Quotas API, videos non integrables, restrictions age/region | Site TV susceptible de rediriger/refuser un navigateur non supporte |

Les deux modes utilisent **Chromium**. Une UI native ne supprime pas le
besoin d'un moteur de lecture HTML : le renderer GPU du MGU ne decode pas
YouTube a lui seul. Aucun scraping, `yt-dlp`, contournement DRM, faux
user-agent ou telechargement de video n'est utilise.

**Essai reel du 12 novembre 2026 :** `youtube.com/tv` se charge dans
Electron, mais affiche « Nous allons vous rediriger vers youtube.com » et
recommande l'application officielle. L'interface TV n'est donc **pas**
validee avec ce runtime. Le navigateur peut suivre la redirection vers
le site standard ; ce n'est pas presente comme un succes du mode TV.
L'interface originale est l'approche principale retenue.
Le meme essai a demarre une vraie video du canal Google for Developers
dans le lecteur embarque (`readyState=4`, `paused=false`, aucune erreur
media). Cela valide le lecteur sur PC, ni l'audio BMW ni le decodage MGU.

## Essayer sur ce PC

Prerequis : Node.js >= 22.12, npm, environnement graphique.

```powershell
cd .\idrive-apps
npm ci
npm start
```

Cocher **Je suis stationne (simulation bureau)**. Ouvrir un lien video ou
choisir **YouTube TV**. La case est une simulation de developpement,
**elle n'existe pas comme autorisation dans le mode voiture**.

Pour activer la recherche, creer une cle YouTube Data API v3 dans votre
projet Google, activer cette API, appliquer des restrictions appropriees
et fixer les quotas. Ne jamais committer cette cle :

```powershell
$env:YOUTUBE_API_KEY = "<votre-cle>"
npm start
```

Une recherche demande au maximum 12 resultats et consomme le quota de
`search.list`. Pas de recherche a chaque frappe. Les resultats reels
viennent de l'API ; aucune donnee de demonstration dans l'application.
Les tests remplacent seulement le contenu des sites tiers.

## Dans le MGU Store

Source GitHub : **`Oussemf/idrive-apps`**, canal **`Releases`**.
Dans le Store, modifier la source existante (actuellement `main`) ou ajouter
la source HTTPS suivante :

`https://github.com/Oussemf/idrive-apps/releases/download/catalog/catalog.json`

Actualiser, installer **YouTube browser companion (experimental)**, puis
mettre a jour **YouTube (experimental)** en **0.2.1**. Le catalogue declare
la dependance pour que le Store installe le compagnon avec le client.
**Aucun fichier runtime.json a creer** : le lanceur trouve automatiquement
`/var/opt/oussem-browser/current/launch.sh` et son projet.
La branche `main` reste un canal de sources pour developpeurs ; le compagnon
binaire est distribue exclusivement par le catalogue Releases.

Le compagnon installe une copie privee d'Electron, glibc et des dependances,
ainsi qu'un affichage virtuel Xvfb sans port TCP, authentifie par cookie
aleatoire. Il s'execute sous l'UID de l'app. Le seul programme setuid est
le helper sandbox officiel de Chromium ; aucune option `--no-sandbox`.
Il n'installe aucun service permanent et se retire depuis le Store.
Prevoir de l'espace disque pour le telechargement, l'extraction et les
sauvegardes du Store ; la taille exacte figure dans le catalogue.

Le paquet declare `mguInternet: true`. Le runtime utilise le **bail DNS
du Store** (`data/uplink.json`) et les routes de l'UID de l'app. Il ne
reconfigure ni le Wi-Fi, ni les routes, ni le resolver systeme. Le partage
Wi-Fi du telephone se regle dans le Store ; son service `mgu-uplink` doit
autoriser cette application. Aucune connexion via le forfait BMW n'est
supposee. Voir [installation et limites materielles](docs/MGU.md).

## Verification

```powershell
npm run check
npm test
npm run test:ui
python -m unittest discover -s tests -p "test_*.py"
npm run preview:mgu
```

Les tests UI lancent de vraies fenetres Electron et verifient notamment
le plein ecran reel, la navigation principale TV, l'isolation du site
distant et l'arret du lecteur. Ils ne prouvent pas qu'une video reelle
est lisible sur MGU. Le test de packaging construit sans SDK ; le Store
fournit le sien depuis le vehicule. Le pipeline du compagnon verifie aussi
un demarrage non-root et sandboxe sur un userland glibc 2.27 avec Node 8.
Le noyau, les politiques OAP et l'audio du vehicule ne sont pas reproduits.

## Securite et statut

- Utilisation **uniquement a l'arret**. Les restrictions d'origine du vehicule
  ne sont pas modifiees.
- Pour les essais dans le garage, choisir **Garage test - original UI**
  ou **Garage test - YouTube TV** dans le lanceur. Cette session ne depend
  pas des signaux de vitesse et affiche un avertissement permanent.
  Elle se termine a la perte de focus, a la sortie ou a l'arret du lanceur ;
  il faut la relancer explicitement. Garder le vehicule stationne.
- Hors de cette session de validation, vitesse exactement nulle et recente, app au premier plan
  et heartbeat recent obligatoires ; signal absent/invalide/perime = blocage.
- Perte de focus, popup, perte du renderer ou du lanceur :
  masquage et arret du lecteur/runtime, sans lecture audio en arriere-plan.
  Le mouvement est controle uniquement hors du mode garage.
- Pas d'API BMW de frein de parking validee ici : vitesse nulle n'est
  **pas** une preuve de position P. Ce garde-fou logiciel experimental
  ne remplace ni les protections du vehicule ni la responsabilite de l'utilisateur.
- Audio MGU, codecs, memoire, performances, YouTube reel et ID8 restent
  a valider. Aucun acces au vehicule n'a ete utilise pour ce developpement.

Architecture et choix : [comparaison detaillee](docs/ARCHITECTURE.md).
Composants MIT/GPL reutilises : [attributions](THIRD_PARTY_NOTICES.md).
Le clone de reference est conserve dans le dossier frere
`../idrive7-apps-reference`, hors de ce depot.
