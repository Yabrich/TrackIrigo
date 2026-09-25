#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Génère les données compactes de la carte (map/data/) à partir des fichiers GTFS.

La carte ne télécharge plus les ~23 Mo de fichiers GTFS bruts (stop_times.txt,
shapes.txt, ...) : ce script prépare une fois pour toutes, côté serveur, des
fichiers JSON compacts, découpés pour n'envoyer que le nécessaire :

  data/network.json                  index léger : lignes, couleurs, noms des fichiers ci-dessous
  data/stops.<empreinte>.json        arrêts (noms + coordonnées)
  data/shapes/<ligne>.<empreinte>.json  tracés simplifiés d'une ligne + jours de circulation
                                     (téléchargé seulement si la ligne est affichée)
  data/trips/<ligne>.<empreinte>.json   horaires d'une ligne, courses factorisées
                                     (téléchargé seulement au clic sur un véhicule)

Le contenu d'un fichier "à empreinte" ne change jamais : le navigateur le garde en
cache (voir map/data/.htaccess) et, après une mise à jour GTFS, seuls les fichiers
réellement modifiés sont retéléchargés. Chaque JSON est aussi écrit pré-compressé
(.json.gz) pour qu'Apache l'envoie compressé sans effort.

Lancé automatiquement par update_gtfs.py ; utilisable seul : python build_map_data.py

Aucune dépendance externe (bibliothèque standard uniquement).
"""
import csv
import gzip
import hashlib
import json
import math
import os
import re
import sys
import time
from collections import defaultdict
from datetime import date, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MAP_DIR = os.path.join(SCRIPT_DIR, "map")
DATA_DIR = os.path.join(MAP_DIR, "data")
BUILD_STATE_FILE = os.path.join(DATA_DIR, ".build_state.json")

# A incrémenter à chaque changement du format produit : force la régénération.
FORMAT_VERSION = 1

SOURCE_FILES = [
    "routes.txt",
    "trips.txt",
    "stop_times.txt",
    "stops.txt",
    "shapes.txt",
    "calendar.txt",
    "calendar_dates.txt",
]

# Tolérance de simplification des tracés (mètres) : invisible à l'écran,
# divise par ~2 le nombre de points.
SHAPE_TOLERANCE_M = 1.0

# Un fichier à empreinte qui n'est plus référencé est conservé ce temps-là,
# pour les pages ouvertes avant la mise à jour.
ORPHAN_GRACE_SECONDS = 2 * 24 * 3600

HASHED_NAME_RE = re.compile(r"\.[0-9a-f]{10}\.json(\.gz)?$")


# ---------------------------------------------------------------------------
# Lecture GTFS
# ---------------------------------------------------------------------------

def read_csv(name):
    path = os.path.join(MAP_DIR, name)
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return [{(k or "").strip(): (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(f)]


def parse_gtfs_date(value):
    try:
        return date(int(value[0:4]), int(value[4:6]), int(value[6:8]))
    except (TypeError, ValueError):
        return None


def parse_gtfs_time(value):
    """'HH:MM:SS' (heures possiblement >= 24) -> secondes, ou None."""
    parts = (value or "").split(":")
    if len(parts) < 2:
        return None
    try:
        h, m = int(parts[0]), int(parts[1])
        s = int(parts[2]) if len(parts) > 2 and parts[2] else 0
    except ValueError:
        return None
    return h * 3600 + m * 60 + s


def to_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default


# ---------------------------------------------------------------------------
# Encodages compacts
# ---------------------------------------------------------------------------

def encode_polyline(points):
    """Algorithme "encoded polyline" (Google), précision 1e-5 (~1 m)."""
    out = []
    prev_lat = prev_lon = 0
    for lat, lon in points:
        ilat = int(round(lat * 1e5))
        ilon = int(round(lon * 1e5))
        for delta in (ilat - prev_lat, ilon - prev_lon):
            v = ~(delta << 1) if delta < 0 else (delta << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)


def simplify(points, tolerance_m):
    """Douglas-Peucker (itératif) en coordonnées métriques locales."""
    if len(points) < 3 or tolerance_m <= 0:
        return points
    kx = 111320.0 * math.cos(math.radians(points[0][0]))
    ky = 110540.0
    xy = [(lon * kx, lat * ky) for lat, lon in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        ax, ay = xy[first]
        dx, dy = xy[last][0] - ax, xy[last][1] - ay
        seg_len2 = dx * dx + dy * dy
        worst, worst_idx = -1.0, -1
        for i in range(first + 1, last):
            px, py = xy[i][0] - ax, xy[i][1] - ay
            if seg_len2 == 0:
                dist = math.hypot(px, py)
            else:
                t = max(0.0, min(1.0, (px * dx + py * dy) / seg_len2))
                dist = math.hypot(px - t * dx, py - t * dy)
            if dist > worst:
                worst, worst_idx = dist, i
        if worst > tolerance_m:
            keep[worst_idx] = True
            stack.append((first, worst_idx))
            stack.append((worst_idx, last))
    return [p for p, k in zip(points, keep) if k]


def days_to_hex(day_indexes, day_count):
    """Ensemble d'indices de jours -> bitset hexadécimal (4 jours par caractère)."""
    if day_count <= 0:
        return ""
    bits = bytearray((day_count + 3) // 4)
    for idx in day_indexes:
        if 0 <= idx < day_count:
            bits[idx >> 2] |= 8 >> (idx & 3)
    return "".join("0123456789abcdef"[b] for b in bits)


def to_json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def slugify(route_id):
    return re.sub(r"[^0-9A-Za-z_-]+", "_", route_id) or "_"


# ---------------------------------------------------------------------------
# Calendrier : jours de circulation de chaque service
# ---------------------------------------------------------------------------

def build_service_days(calendar_rows, calendar_dates_rows):
    """-> (date de base, nombre de jours, dict service_id -> set(indices de jours))."""
    all_dates = []
    for row in calendar_rows:
        for key in ("start_date", "end_date"):
            d = parse_gtfs_date(row.get(key))
            if d:
                all_dates.append(d)
    for row in calendar_dates_rows:
        d = parse_gtfs_date(row.get("date"))
        if d:
            all_dates.append(d)
    if not all_dates:
        return None, 0, {}

    base = min(all_dates)
    day_count = (max(all_dates) - base).days + 1
    weekday_fields = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

    service_days = defaultdict(set)
    for row in calendar_rows:
        service_id = row.get("service_id")
        start = parse_gtfs_date(row.get("start_date"))
        end = parse_gtfs_date(row.get("end_date"))
        if not service_id or not start or not end:
            continue
        runs = [row.get(field) == "1" for field in weekday_fields]
        day = start
        while day <= end:
            if runs[day.weekday()]:
                service_days[service_id].add((day - base).days)
            day += timedelta(days=1)

    for row in calendar_dates_rows:
        service_id = row.get("service_id")
        d = parse_gtfs_date(row.get("date"))
        if not service_id or not d:
            continue
        idx = (d - base).days
        if row.get("exception_type") == "1":
            service_days[service_id].add(idx)
        elif row.get("exception_type") == "2":
            service_days[service_id].discard(idx)

    return base, day_count, service_days


# ---------------------------------------------------------------------------
# Tracés
# ---------------------------------------------------------------------------

def read_shape_points(wanted_ids):
    """shapes.txt -> dict shape_id -> [(lat, lon), ...] trié par shape_pt_sequence."""
    raw = defaultdict(list)
    for i, row in enumerate(read_csv("shapes.txt")):
        shape_id = row.get("shape_id")
        if not shape_id or shape_id not in wanted_ids:
            continue
        try:
            lat = float(row.get("shape_pt_lat"))
            lon = float(row.get("shape_pt_lon"))
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(lat) and math.isfinite(lon)):
            continue
        seq = to_int(row.get("shape_pt_sequence"), i)
        raw[shape_id].append((seq, lat, lon))
    return {sid: [(lat, lon) for _, lat, lon in sorted(pts, key=lambda p: p[0])]
            for sid, pts in raw.items()}


# ---------------------------------------------------------------------------
# Horaires
# ---------------------------------------------------------------------------

def fill_missing_times(times):
    """Interpole linéairement les horaires absents (arrêts non "timepoints")."""
    known = [i for i, t in enumerate(times) if t is not None]
    if not known:
        return None
    filled = list(times)
    for i in range(0, known[0]):
        filled[i] = times[known[0]]
    for i in range(known[-1] + 1, len(times)):
        filled[i] = times[known[-1]]
    for a, b in zip(known, known[1:]):
        for i in range(a + 1, b):
            filled[i] = int(round(times[a] + (times[b] - times[a]) * (i - a) / (b - a)))
    return filled


def read_stop_times_by_trip():
    by_trip = defaultdict(list)
    for i, row in enumerate(read_csv("stop_times.txt")):
        trip_id = row.get("trip_id")
        stop_id = row.get("stop_id")
        if not trip_id or not stop_id:
            continue
        arrival = parse_gtfs_time(row.get("arrival_time"))
        departure = parse_gtfs_time(row.get("departure_time"))
        by_trip[trip_id].append((to_int(row.get("stop_sequence"), i), stop_id,
                                 arrival if arrival is not None else departure,
                                 departure if departure is not None else arrival))
    return by_trip


class TripTable:
    """Horaires d'une ligne, factorisés.

    stops     : identifiants d'arrêts utilisés par la ligne
    patterns  : suites d'arrêts (indices dans stops)
    profiles  : [pattern, temps de parcours entre arrêts successifs (s),
                 temps d'arrêt éventuels [indice, durée, indice, durée, ...]]
    headsigns : destinations
    trips     : trip_id -> [profile, heure d'arrivée au 1er arrêt (s), destination]
                (-1 si inconnu)
    """

    def __init__(self):
        self.stop_index = {}
        self.pattern_index = {}
        self.profile_index = {}
        self.headsign_index = {}
        self.trips = {}

    @staticmethod
    def _intern(table, key):
        idx = table.get(key)
        if idx is None:
            idx = table[key] = len(table)
        return idx

    def add(self, trip_id, headsign, stop_times):
        profile = -1
        start = 0
        entries = sorted(stop_times, key=lambda e: e[0])
        arrivals = fill_missing_times([e[2] for e in entries]) if entries else None
        departures = fill_missing_times([e[3] for e in entries]) if entries else None
        if arrivals and departures:
            pattern = tuple(self._intern(self.stop_index, e[1]) for e in entries)
            pattern_id = self._intern(self.pattern_index, pattern)
            travel = tuple(arrivals[i] - departures[i - 1] for i in range(1, len(entries)))
            dwell = []
            for i in range(len(entries)):
                if departures[i] != arrivals[i]:
                    dwell += [i, departures[i] - arrivals[i]]
            profile = self._intern(self.profile_index, (pattern_id, travel, tuple(dwell)))
            start = arrivals[0]
        headsign_id = self._intern(self.headsign_index, headsign) if headsign else -1
        self.trips[trip_id] = [profile, start, headsign_id]

    def to_json(self):
        profiles = []
        for pattern_id, travel, dwell in self.profile_index:
            profiles.append([pattern_id, list(travel), list(dwell)] if dwell
                            else [pattern_id, list(travel)])
        return {
            "stops": list(self.stop_index),
            "patterns": [list(p) for p in self.pattern_index],
            "profiles": profiles,
            "headsigns": list(self.headsign_index),
            "trips": self.trips,
        }


# ---------------------------------------------------------------------------
# Ecriture des fichiers
# ---------------------------------------------------------------------------

def replace_atomic(dest, content, attempts=5):
    """Ecrit puis remplace de façon atomique (fichier possiblement verrouillé sous Windows)."""
    tmp = dest + ".tmp"
    with open(tmp, "wb") as f:
        f.write(content)
    for i in range(attempts):
        try:
            os.replace(tmp, dest)
            return
        except OSError:
            if i == attempts - 1:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                raise
            time.sleep(1 + i)


class Writer:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.referenced = set()
        self.written = 0
        self.bytes_gz = {}

    def _write_pair(self, rel_path, content):
        """Ecrit <rel_path> et <rel_path>.gz si le contenu a changé."""
        path = os.path.join(self.data_dir, rel_path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        compressed = gzip.compress(content, compresslevel=9, mtime=0)
        self.bytes_gz[rel_path] = len(compressed)
        for target, payload in ((path, content), (path + ".gz", compressed)):
            try:
                with open(target, "rb") as f:
                    if f.read() == payload:
                        continue
            except OSError:
                pass
            replace_atomic(target, payload)
            self.written += 1
        self.referenced.add(rel_path)
        self.referenced.add(rel_path + ".gz")

    def write_hashed(self, folder, stem, obj):
        content = to_json_bytes(obj)
        digest = hashlib.sha1(content).hexdigest()[:10]
        rel_path = "/".join(filter(None, [folder, f"{stem}.{digest}.json"]))
        self._write_pair(rel_path, content)
        return rel_path

    def write_fixed(self, rel_path, obj):
        self._write_pair(rel_path, to_json_bytes(obj))


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------

def source_signature():
    sig = {}
    for name in SOURCE_FILES:
        try:
            st = os.stat(os.path.join(MAP_DIR, name))
            sig[name] = [st.st_size, st.st_mtime_ns]
        except OSError:
            sig[name] = None
    return sig


def load_build_state():
    try:
        with open(BUILD_STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_build_state(state):
    os.makedirs(DATA_DIR, exist_ok=True)
    replace_atomic(BUILD_STATE_FILE, json.dumps(state, indent=2, ensure_ascii=False).encode("utf-8"))


def needs_rebuild(state=None):
    state = load_build_state() if state is None else state
    return (state.get("format") != FORMAT_VERSION
            or state.get("sources") != source_signature()
            or not os.path.exists(os.path.join(DATA_DIR, "network.json")))


def build():
    """Régénère map/data/. Renvoie un résumé (dict)."""
    started = time.time()
    signature = source_signature()

    routes_rows = read_csv("routes.txt")
    trips_rows = read_csv("trips.txt")
    stops_rows = read_csv("stops.txt")
    if not routes_rows or not trips_rows or not stops_rows:
        raise RuntimeError("routes.txt, trips.txt ou stops.txt absent ou vide")

    base, day_count, service_days = build_service_days(read_csv("calendar.txt"),
                                                       read_csv("calendar_dates.txt"))
    base_key = base.strftime("%Y%m%d") if base else ""

    writer = Writer(DATA_DIR)

    # --- Arrêts : colonnes + coordonnées en "encoded polyline"
    stop_ids, stop_names, coords, no_coords = [], [], [], []
    for row in stops_rows:
        stop_id = row.get("stop_id")
        if not stop_id:
            continue
        try:
            lat, lon = float(row.get("stop_lat")), float(row.get("stop_lon"))
            valid = math.isfinite(lat) and math.isfinite(lon)
        except (TypeError, ValueError):
            valid = False
        if not valid:
            no_coords.append(len(stop_ids))
            lat, lon = coords[-1] if coords else (0.0, 0.0)
        stop_ids.append(stop_id)
        stop_names.append(row.get("stop_name", ""))
        coords.append((lat, lon))
    stops_obj = {"id": stop_ids, "name": stop_names, "coords": encode_polyline(coords)}
    if no_coords:
        stops_obj["noCoords"] = no_coords
    stops_file = writer.write_hashed("", "stops", stops_obj)

    # --- Regroupement des courses par ligne
    trips_by_route = defaultdict(list)
    for row in trips_rows:
        if row.get("route_id") and row.get("trip_id"):
            trips_by_route[row["route_id"]].append(row)

    # Jours de circulation de chaque (ligne, tracé)
    shape_days = defaultdict(lambda: defaultdict(set))
    for route_id, rows in trips_by_route.items():
        for row in rows:
            shape_id = row.get("shape_id")
            days = service_days.get(row.get("service_id"))
            if shape_id and row.get("service_id"):
                shape_days[route_id][shape_id].update(days or ())
    active_days = set()
    for by_shape in shape_days.values():
        for days in by_shape.values():
            active_days |= days

    wanted_shapes = {sid for by_shape in shape_days.values() for sid in by_shape}
    shape_points = read_shape_points(wanted_shapes)
    encoded_shapes = {}
    point_count = 0
    for shape_id, points in shape_points.items():
        if len(points) < 2:
            continue
        simplified = simplify(points, SHAPE_TOLERANCE_M)
        point_count += len(simplified)
        encoded_shapes[shape_id] = encode_polyline(simplified)

    stop_times = read_stop_times_by_trip()

    # --- Un fichier de tracés et un fichier d'horaires par ligne
    routes_out = []
    for row in routes_rows:
        route_id = row.get("route_id")
        if not route_id:
            continue
        entry = {"id": route_id, "color": row.get("route_color", ""), "name": row.get("route_long_name", "")}
        slug = slugify(route_id)

        shapes = [[shape_id, days_to_hex(days, day_count), encoded_shapes[shape_id]]
                  for shape_id, days in sorted(shape_days.get(route_id, {}).items())
                  if shape_id in encoded_shapes]
        if shapes:
            entry["shapes"] = writer.write_hashed("shapes", slug, {"base": base_key, "shapes": shapes})

        route_trips = trips_by_route.get(route_id)
        if route_trips:
            table = TripTable()
            for trip in sorted(route_trips, key=lambda t: t["trip_id"]):
                table.add(trip["trip_id"], trip.get("trip_headsign", ""), stop_times.get(trip["trip_id"], []))
            entry["trips"] = writer.write_hashed("trips", slug, table.to_json())

        routes_out.append(entry)

    # --- Index (écrit en dernier : il ne référence que des fichiers déjà présents)
    network = {
        "format": FORMAT_VERSION,
        "base": base_key,
        "active": days_to_hex(active_days, day_count),
        "stops": stops_file,
        "routes": routes_out,
    }
    writer.write_fixed("network.json", network)

    state = load_build_state()
    state.update({"format": FORMAT_VERSION, "sources": signature})
    removed = cleanup_orphans(writer.referenced, state)
    save_build_state(state)

    sizes = writer.bytes_gz
    return {
        "seconds": round(time.time() - started, 1),
        "files_written": writer.written,
        "files_removed": removed,
        "routes": len(routes_out),
        "shape_points": point_count,
        "network_gz": sizes.get("network.json", 0),
        "stops_gz": sizes.get(stops_file, 0),
        "shapes_gz": sum(v for k, v in sizes.items() if k.startswith("shapes/")),
        "trips_gz": sum(v for k, v in sizes.items() if k.startswith("trips/")),
    }


def cleanup_orphans(referenced, state):
    """Supprime les fichiers à empreinte qui ne sont plus référencés depuis ORPHAN_GRACE_SECONDS."""
    now = time.time()
    orphans = state.get("orphans", {})
    still_orphans = {}
    removed = 0
    for folder in ("", "shapes", "trips"):
        directory = os.path.join(DATA_DIR, folder)
        if not os.path.isdir(directory):
            continue
        for name in os.listdir(directory):
            if not HASHED_NAME_RE.search(name):
                continue
            rel_path = "/".join(filter(None, [folder, name]))
            if rel_path in referenced:
                continue
            since = orphans.get(rel_path, now)
            if now - since >= ORPHAN_GRACE_SECONDS:
                try:
                    os.remove(os.path.join(directory, name))
                    removed += 1
                    continue
                except OSError:
                    pass
            still_orphans[rel_path] = since
    state["orphans"] = still_orphans
    return removed


def build_if_needed(log=print, force=False):
    """Régénère les données si les fichiers GTFS ont changé. Renvoie le résumé ou None."""
    state = load_build_state()
    if not force and not needs_rebuild(state):
        # Rien à régénérer, mais on purge les anciens fichiers arrivés à échéance.
        if state.get("orphans"):
            removed = _cleanup_only(state)
            if removed:
                log(f"Donnees carte : {removed} ancien(s) fichier(s) supprime(s).")
        return None
    summary = build()
    log("Donnees carte regenerees en {seconds} s : {files_written} fichier(s) ecrit(s), "
        "{files_removed} supprime(s) ; index {network_gz} o, arrets {stops_gz} o, "
        "traces {shapes_gz} o, horaires {trips_gz} o (gzip, toutes lignes).".format(**summary))
    return summary


def _cleanup_only(state):
    referenced = set()
    try:
        with open(os.path.join(DATA_DIR, "network.json"), "r", encoding="utf-8") as f:
            network = json.load(f)
    except (OSError, ValueError):
        return 0
    for rel_path in [network.get("stops")] + [r.get(k) for r in network.get("routes", [])
                                               for k in ("shapes", "trips")]:
        if rel_path:
            referenced.add(rel_path)
            referenced.add(rel_path + ".gz")
    removed = cleanup_orphans(referenced, state)
    save_build_state(state)
    return removed


if __name__ == "__main__":
    force = "--force" in sys.argv[1:]
    result = build_if_needed(force=force)
    if result is None:
        print("Donnees carte deja a jour (utiliser --force pour regenerer).")
