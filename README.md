# YouTube pour iDrive

Client non officiel pour BMW iDrive 7. **Work in progress.**

Base de depart : [RideTube de JustAnotherPU](https://github.com/JustAnotherPU/ridetube),
revision `63364945d85344071dda0821464c4822372001e7`. Son application, son
service et son decodeur sont distribues sous GPL-3.0-or-later ; les autres
licences et credits sont dans [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).

La lecture video est reservee au stationnement. En VM, les tests peuvent
simuler un capteur de vitesse a zero ; une vitesse inconnue bloque l'image
sur le MGU. Le service upstream conserve son identifiant technique
`jap-ridetube-d` pour compatibilite.

Dans le Store, utiliser la source `Oussemf/idrive-apps` sur `main` :
l'application est construite sur le MGU avec son SDK local. Le catalogue
des releases correspond encore a l'ancienne application. Le service peut
necessiter la source `JustAnotherPU/mgu-apps` pour `jap-node22`.

# Waze on cluster (fork)

Import de [Waze on cluster de robertnisipeanu](https://github.com/robertnisipeanu/idrive-apps),
commit `7ad7a0bbea7a426c77580a07a4da64b644edc9bf` (app `robertn_waze_cluster` 0.6.8,
`waze-on-cluster` 0.9.14, `cluster-render` 0.5.12), GPL-3.0-or-later. L'identifiant
`robertn_waze_cluster` est conserve pour compatibilite. Documentation d'origine :
[app](apps/robertn_waze_cluster/README.md), [service](native/waze-on-cluster/README.md),
[renderer](native/cluster-render/README.md).

Ce repo publie l'app (0.7.0, construite sur le MGU) et l'outil
`waze-on-cluster` 0.10.0 ([store/waze-on-cluster](store/waze-on-cluster), le
binaire de la release upstream 0.9.14 avec les scripts modifies ici).
`cluster-render` et `mgu-deploy` viennent toujours de leurs sources du Store
(`robertnisipeanu/idrive-apps`, `robertnisipeanu/mgu-store`).

**Installation par le Store.** Le Store ne met a jour un composant que depuis
la source qui l'a installe : si Waze on cluster est deja installe depuis
`robertnisipeanu/idrive-apps`, desinstaller l'app puis l'outil
`waze-on-cluster`, puis installer l'app depuis la source `Oussemf/idrive-apps`
(canal `branch:waze-cluster-wide-map` tant que la branche n'est pas fusionnee).
Garder la source upstream pour `cluster-render`. Appliquer ensuite le patch
Android Auto dans l'app si besoin.

## Carte large sous les jauges

Case **Carte large (sous les cadrans)** dans la section Android Auto de l'app,
active au prochain redemarrage du systeme (bouton **Redemarrer le systeme**).
Le telephone dessine sa carte dans une bande 1280x416, affichee etiree a sa
forme dans un rectangle 1600x520 (x 160, y 100) du cluster, dans le slot KOMBI
`0x200` ou BMW affiche son contenu pleine largeur sous les jauges : vitesse,
regime et alertes restent dessines par-dessus. Meme texture 1088x480 que la
carte standard, donc meme debit vers le cluster. Exclusive avec **Masquer le
guidage du telephone** ; la decocher (ou **Retirer le correctif**) revient a la
carte standard. Details : [README du service](native/waze-on-cluster/README.md).

Non verifie sur voiture : si `0x200` n'est pas sous les jauges (carte
invisible, ou par-dessus les compteurs), decocher la case. La carte large
s'applique aussi a un flux CarPlay (etire) : la decocher avant d'utiliser
CarPlay. Les reglages
sont dans [aapd_conf.js](native/waze-on-cluster/patch/aapd_conf.js) (`WIDE`).
Apres une modification des scripts, `node tools/stage_waze_on_cluster.js`
regenere `store/waze-on-cluster` (le CI le verifie).

**Sonde manuelle (SSH, sans l'app).** Le meme rendu se teste par les confs
locales, en root sur le MGU :

```sh
sh wide-probe.sh apply                 # panel dans 0x200, carte etiree en 160,100,1600,520
sh wide-probe.sh status                # table des slots et logs
sh wide-probe.sh apply 0x200 160,100,1600,520 --take-over   # si la carte reste invisible
sh wide-probe.sh revert                # retour aux confs d'avant la sonde
```

Le script ([native/waze-on-cluster/tools/wide-probe.sh](native/waze-on-cluster/tools/wide-probe.sh))
sauvegarde `cluster-render.local.conf` et `waze-on-cluster.local.conf`, y
met `panel_slot`, `target = panel` et `map_rect`, puis redemarre les deux
services.
