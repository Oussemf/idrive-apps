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
