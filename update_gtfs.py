#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Met à jour automatiquement les fichiers GTFS Irigo.

Télécharge https://chouette.enroute.mobi/api/v1/datas/Irigo/gtfs.zip UNIQUEMENT
si le flux distant a changé (comparaison via l'en-tête HTTP ETag / Last-Modified),
puis extrait les fichiers voulus (stop_times.txt, trips.txt) dans le dossier /map.

Conçu pour être lancé périodiquement (Planificateur de tâches Windows). Grâce à
la requête conditionnelle, un lancement ne télécharge rien tant qu'il n'y a pas
de nouvelle version : il est donc sans risque de l'exécuter souvent.

Aucune dépendance externe (bibliothèque standard uniquement).
"""
import io
import json
import os
import sys
import zipfile
import urllib.request
import urllib.error
from datetime import datetime

GTFS_URL = "https://chouette.enroute.mobi/api/v1/datas/Irigo/gtfs.zip"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MAP_DIR = os.path.join(SCRIPT_DIR, "map")
STATE_FILE = os.path.join(MAP_DIR, ".gtfs_state.json")
LOG_FILE = os.path.join(SCRIPT_DIR, "update_gtfs.log")

# Fichiers présents dans le zip à extraire dans /map.
# Ajouter ici "stops.txt", "routes.txt", etc. si besoin de les synchroniser aussi.
FILES_TO_EXTRACT = ["stop_times.txt", "trips.txt", "stops.txt", "routes.txt"]


def log(msg):
    line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def load_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def main():
    state = load_state()

    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "TrackIrigo-GTFS-Updater/1.0"})
    # Requête conditionnelle : le serveur répond 304 si rien n'a changé.
    if state.get("etag"):
        req.add_header("If-None-Match", state["etag"])
    if state.get("last_modified"):
        req.add_header("If-Modified-Since", state["last_modified"])

    try:
        resp = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as e:
        if e.code == 304:
            log("Aucune mise à jour disponible (304 Not Modified).")
            return 0
        log(f"Erreur HTTP {e.code} : {e.reason}")
        return 1
    except urllib.error.URLError as e:
        log(f"Erreur reseau : {e.reason}")
        return 1

    data = resp.read()
    etag = resp.headers.get("ETag")
    last_modified = resp.headers.get("Last-Modified")

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        log("Le fichier telecharge n'est pas un zip valide, abandon.")
        return 1

    names = set(zf.namelist())
    updated = []
    for name in FILES_TO_EXTRACT:
        if name not in names:
            log(f"Attention : {name} absent du zip, ignore.")
            continue
        content = zf.read(name)
        dest = os.path.join(MAP_DIR, name)
        tmp = dest + ".tmp"
        # Ecriture puis remplacement atomique pour ne jamais laisser un fichier tronque.
        with open(tmp, "wb") as f:
            f.write(content)
        os.replace(tmp, dest)
        updated.append(f"{name} ({len(content)} octets)")

    log("Nouvelle version detectee. Mise a jour : " + ", ".join(updated))

    state["etag"] = etag
    state["last_modified"] = last_modified
    state["updated_at"] = datetime.now().isoformat(timespec="seconds")
    save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
