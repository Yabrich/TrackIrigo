# 🌍 Track'Irigo — Carte temps réel Irigo

![Version](https://img.shields.io/badge/version-2.2.1-blue?style=for-the-badge)

Une carte interactive pensée pour rendre les déplacements sur le réseau **Irigo (Angers Loire Métropole)** plus simples et plus lisibles, avec un accès centralisé aux informations en temps réel.

Site principal : **[https://trackirigo.yabrich.fr](https://trackirigo.yabrich.fr)**

Carte uniquement : **[https://trackirigo.yabrich.fr/map](https://trackirigo.yabrich.fr/map)**

---

## ✨ Pourquoi ce projet ?

Les outils existants permettent de consulter les horaires, mais restent peu adaptés à une visualisation claire et rapide du réseau **en temps réel**.

Track'Irigo vise à proposer une interface plus directe, centrée sur :

* la visualisation des véhicules,
* l’accès aux prochains passages,
* et l’information trafic.

---

## 🚀 Fonctionnalités principales

### 🚌 Véhicules en temps réel

* Affichage instantané des véhicules du réseau
* Clic sur un véhicule pour voir :

  * numéro de parc
  * ligne
  * destination
  * prochain arrêt

### 🎯 Suivi intelligent

* Bouton **Suivre ce véhicule**
* Centrage automatique et dynamique sur le véhicule sélectionné

### 🗺️ Filtrage des lignes

* Affichage personnalisable :

  * Tram A / B / C
  * Bus 01 → 42
* Permet de réduire la charge visuelle

### 📍 Localisation

* Centrage de la carte sur la position utilisateur

### 🌓 Mode jour / nuit automatique

* Adaptation du fond de carte et de la page d’accueil selon l’heure locale
* Basé sur le calcul du lever et coucher du soleil

### ⚡ Chargement rapide

* La carte s’affiche en une fraction de seconde, même sur une connexion lente
* Les tracés et horaires d’une ligne ne sont téléchargés que lorsqu’ils sont utiles

---

## 🆕 Nouveautés (v1.2.0)

### 🧭 Nouveau menu principal

* Navigation centralisée dans l’application
* Accès rapide aux lignes, infos trafic et fonctionnalités

### 🚧 Panneau d’information trafic

* Affichage des perturbations en cours
* Mise en évidence des impacts réseau (retards, interruptions, déviations)

### ~~📄 Pages dédiées aux lignes~~

* ~~Une page par ligne~~
* ~~Vue plus claire des informations spécifiques (trajet, desserte, etc.)~~

### ~~⏱️ Prochains passages en temps réel~~

* ~~Tableau des prochains passages pour chaque arrêt~~
* ~~Données dynamiques issues du temps réel~~
* ~~Consultation rapide sans passer par une interface externe~~

*(Fonctionnalitées retirées en v2.2)*

---

# 📦 Notes de patch

## 🔖 Version 2.2.1

**Performances de la carte :**

* La carte ne télécharge plus les ~23 Mo de fichiers GTFS bruts à chaque visite : **~34 Ko** au premier chargement (au lieu de ~40 s avec un débit montant de 5 Mbps)
* Tracés chargés uniquement pour les lignes affichées, horaires chargés au clic sur un véhicule
* Mise en cache navigateur : une visite suivante ne retélécharge que ce qui a changé
* Tracés simplifiés (écart maximal ~1,5 m), rendu plus léger
* Suppression d’une bibliothèque inutilisée (~900 Ko) et logo allégé

**Page d’accueil :**

* Mode sombre automatique selon le lever / coucher du soleil
* Section « Stations » masquée temporairement (mise à jour prévue)

---

## 🔖 Version 1.2.0

**Ajouts majeurs :**

* Ajout d’un **menu principal** pour structurer la navigation
* Intégration d’un **panneau d’information trafic**
* Création de **pages dédiées pour chaque ligne**
* Ajout des **tableaux de prochains passages en temps réel par arrêt**

---

## 🔖 Version 1.1.2

**Fonctionnalités existantes :**

* Véhicules en temps réel
* Suivi dynamique
* Filtrage des lignes
* Mode jour / nuit
* Géolocalisation

---

# 🛠️ Fonctionnement des données (serveur)

Les horaires théoriques proviennent du flux GTFS Irigo.

* `update_gtfs.py` (lancé chaque jour par le Planificateur de tâches) télécharge le GTFS **uniquement s’il a changé**, extrait les fichiers dans `map/`, puis lance `build_map_data.py`.
* `build_map_data.py` génère dans `map/data/` des fichiers JSON compacts et pré-compressés (`.gz`) :
  * `network.json` : index des lignes (couleurs, noms, fichiers associés)
  * `stops.<empreinte>.json` : arrêts
  * `shapes/<ligne>.<empreinte>.json` : tracés d’une ligne et jours de circulation
  * `trips/<ligne>.<empreinte>.json` : horaires d’une ligne
* `map/data/.htaccess` fait servir les versions compressées par Apache et gère le cache navigateur.

Après un déploiement, lancer une fois :

```bash
python update_gtfs.py
```

Pour forcer la régénération des données : `python build_map_data.py --force`.
