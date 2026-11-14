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

Pour l'instant seule l'app est publiee par ce repo (construite sur le MGU) ;
les outils `waze-on-cluster` et `cluster-render` viennent encore de la source
`robertnisipeanu/idrive-apps` du Store, a ajouter aussi.

## Objectif : carte large sous les jauges

Afficher la carte plus large que la zone centrale 1088x480 (slot KOMBI `0x100`),
avec la vitesse, le regime et les overlays BMW toujours dessines par-dessus,
active par un reglage de l'app. Le slot `panel` (`0x203`) couvre tout le
cluster mais par-dessus les jauges (upstream issue #131) ; le slot `0x200`,
ou BMW affiche un contenu pleine largeur (`0x01000500`), est le candidat a
tester pour une couche sous les jauges.

**Sonde (configuration seule, binaires upstream).** En root sur le MGU :

```sh
sh wide-probe.sh apply                 # panel dans 0x200, carte etiree en 160,100,1600,520
sh wide-probe.sh status                # table des slots et logs
sh wide-probe.sh apply 0x200 160,100,1600,520 --take-over   # si la carte reste invisible
sh wide-probe.sh revert                # retour aux confs d'avant la sonde
```

Le script ([native/waze-on-cluster/tools/wide-probe.sh](native/waze-on-cluster/tools/wide-probe.sh))
sauvegarde `cluster-render.local.conf` et `waze-on-cluster.local.conf`, y
met `panel_slot`, `target = panel` et `map_rect`, puis redemarre les deux
services. A noter pendant le test : la carte s'affiche-t-elle, et les jauges,
la vitesse et les alertes restent-elles visibles par-dessus ? La sortie de
`status` donne l'etat du slot (`status`, `map`).
