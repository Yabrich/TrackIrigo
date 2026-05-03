const DATA_PATHS = {
  stops: 'map/stops.txt',
  trips: 'map/trips.txt',
  stopTimes: 'map/stop_times.txt',
  realtimeFallback: 'irigo.json'
};

const LINE_LOGO_NAMES = new Set([
  'A', 'B', 'C',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  'E20', 'E21', 'E22', 'E23', 'E24', 'E25',
  '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42'
]);

export const lineColorByRouteKey = {
  A: '#E30613',
  B: '#00569D',
  C: '#379E32',
  '01': '#008E8C',
  '02': '#9B1670',
  '03': '#F18700',
  '04': '#009EE1',
  '05': '#FFDD00',
  '06': '#291F6C',
  '07': '#AE0F0A',
  '08': '#E50076',
  '09': '#E94F35',
  '10': '#7263A9',
  '11': '#7B5C4D',
  '12': '#127C29',
  '20': '#E7343F',
  '21': '#95C11F',
  '22': '#C94191',
  '23': '#F08046',
  '24': '#00A7A7',
  '25': '#F9B000',
  '30': '#E6007E',
  '31': '#008530',
  '32': '#0063AF',
  '33': '#951B81',
  '34': '#F39200',
  '35': '#00A6E2',
  '36': '#D2091E',
  '37': '#9CA61F',
  '38': '#008E8C',
  '39': '#E84E0F',
  '40': '#7263A9',
  '41': '#DEA600',
  '42': '#291F6C'
};

let transitDataPromise = null;

export function parseCSV(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim() !== '');
  if (!lines.length) return [];

  function splitCSV(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result.map(value => value.trim());
  }

  const headers = splitCSV(lines[0]).map(header => header.replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = splitCSV(line);
    return headers.reduce((entry, header, index) => {
      let value = values[index] ?? '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/""/g, '"');
      }
      entry[header] = value;
      return entry;
    }, {});
  });
}

export function normalizeRouteId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const expressMatch = raw.match(/^E(\d{1,2})$/i);
  if (expressMatch) return expressMatch[1].padStart(2, '0');
  if (/^[0-9]{1,2}$/.test(raw)) return raw.padStart(2, '0');
  return raw.toUpperCase();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getRouteSortNumber(routeId) {
  const routeKey = normalizeRouteId(routeId);
  if (routeKey === 'A') return 1;
  if (routeKey === 'B') return 2;
  if (routeKey === 'C') return 3;
  if (/^\d+$/.test(routeKey)) return 100 + Number(routeKey);
  return 10000;
}

export function compareRouteIds(left, right) {
  const leftSort = getRouteSortNumber(left);
  const rightSort = getRouteSortNumber(right);
  if (leftSort !== rightSort) return leftSort - rightSort;
  return getRouteDisplayName(left).localeCompare(getRouteDisplayName(right), 'fr', { numeric: true });
}

export function getRouteDisplayName(routeId) {
  const routeKey = normalizeRouteId(routeId);
  if (!routeKey) return '';
  if (routeKey === 'A' || routeKey === 'B' || routeKey === 'C') return routeKey;
  if (/^\d+$/.test(routeKey)) {
    const number = Number(routeKey);
    if (number >= 1 && number <= 12) return String(number);
    if (number >= 20 && number <= 25) return `E${number}`;
    return String(number);
  }
  return routeKey;
}

export function getRouteLogoUrl(routeId) {
  const routeName = getRouteDisplayName(routeId);
  if (!LINE_LOGO_NAMES.has(routeName)) return null;
  return new URL(`img/lignes/${routeName}.svg`, import.meta.url).href;
}

export function isSupportedRouteId(routeId) {
  return LINE_LOGO_NAMES.has(getRouteDisplayName(routeId));
}

export function createLineLogoElement(routeId, className = 'line-logo') {
  const routeKey = normalizeRouteId(routeId);
  const routeName = getRouteDisplayName(routeId);
  const logoUrl = getRouteLogoUrl(routeId);

  if (logoUrl) {
    const image = document.createElement('img');
    image.className = className;
    image.src = logoUrl;
    image.alt = `Ligne ${routeName}`;
    image.loading = 'lazy';
    return image;
  }

  const fallback = document.createElement('span');
  fallback.className = `${className} ${className}--fallback`;
  fallback.textContent = routeName;
  fallback.setAttribute('aria-label', `Ligne ${routeName}`);
  fallback.style.setProperty('--line-accent-color', lineColorByRouteKey[routeKey] || '#d61f2c');
  return fallback;
}

export function getPassagesUrl(stopId) {
  const url = new URL('stations/passages.html', import.meta.url);
  url.searchParams.set('stop', stopId);
  return url.href;
}

export function getStationMapUrl(station) {
  const url = new URL('map/', import.meta.url);
  if (station && Array.isArray(station.lineIds) && station.lineIds.length) {
    url.searchParams.set('lines', station.lineIds.map(normalizeRouteId).join(','));
  }
  if (station && Number.isFinite(station.lat) && Number.isFinite(station.lon)) {
    url.searchParams.set('lat', String(station.lat));
    url.searchParams.set('lon', String(station.lon));
    url.searchParams.set('zoom', '17');
    url.searchParams.set('stop', station.primaryStopId);
  }
  return url.href;
}

async function fetchTextResource(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pour ${path}`);
  }
  return response.text();
}

function parseGtfsTimeToSeconds(value) {
  const parts = String(value || '').split(':').map(part => Number(part));
  if (parts.length < 2 || parts.some(part => !Number.isFinite(part))) return null;
  const [hours, minutes, seconds = 0] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

function getCurrentServiceSeconds(date = new Date()) {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function getNextDeltaSeconds(gtfsSeconds, nowSeconds) {
  let delta = gtfsSeconds - nowSeconds;
  while (delta < 0) delta += 24 * 3600;
  return delta;
}

function secondsToMinutes(seconds) {
  return Math.max(0, Math.floor(seconds / 60));
}

function isTripActiveForDate(trip, date) {
  const serviceId = String(trip.serviceId || '');
  const normalizedServiceId = normalizeText(serviceId);
  const dayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1;
  const dayPattern = serviceId.match(/(?:^|[-_])([01]{7})(?:[-_]|$)/);

  if (dayPattern) {
    return dayPattern[1][dayIndex] === '1';
  }

  if (normalizedServiceId.includes('dimanche')) return date.getDay() === 0;
  if (normalizedServiceId.includes('samedi')) return date.getDay() === 6;
  if (normalizedServiceId.includes('semaine') || normalizedServiceId.includes('lav')) {
    return date.getDay() >= 1 && date.getDay() <= 5;
  }
  if (normalizedServiceId.includes('7-jours') || normalizedServiceId.includes('7 jours')) return true;

  return true;
}

function haversineMeters(leftLat, leftLon, rightLat, rightLon) {
  const earthRadius = 6371000;
  const lat1 = leftLat * Math.PI / 180;
  const lat2 = rightLat * Math.PI / 180;
  const deltaLat = (rightLat - leftLat) * Math.PI / 180;
  const deltaLon = (rightLon - leftLon) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadTransitData() {
  if (transitDataPromise) return transitDataPromise;

  transitDataPromise = Promise.all([
    fetchTextResource(DATA_PATHS.stops),
    fetchTextResource(DATA_PATHS.trips),
    fetchTextResource(DATA_PATHS.stopTimes)
  ]).then(([stopsText, tripsText, stopTimesText]) => {
    const stopRows = parseCSV(stopsText);
    const tripRows = parseCSV(tripsText);
    const stopTimeRows = parseCSV(stopTimesText);

    const stopsById = new Map();
    const tripsById = new Map();
    const stopTimesByStop = new Map();
    const stopTimesByTrip = new Map();
    const stationGroupsByKey = new Map();
    const stationByStopId = new Map();

    stopRows.forEach(row => {
      const id = String(row.stop_id || row.STOP_ID || '').trim();
      const name = String(row.stop_name || row.STOP_NAME || '').trim();
      if (!id || !name) return;

      const stop = {
        id,
        name,
        lat: Number(row.stop_lat || row.STOP_LAT),
        lon: Number(row.stop_lon || row.STOP_LON)
      };
      stopsById.set(id, stop);

      const groupKey = normalizeText(name);
      let station = stationGroupsByKey.get(groupKey);
      if (!station) {
        station = {
          key: groupKey,
          id,
          primaryStopId: id,
          name,
          lat: stop.lat,
          lon: stop.lon,
          stopIds: [],
          lineIds: [],
          searchText: '',
          lineSet: new Set()
        };
        stationGroupsByKey.set(groupKey, station);
      }
      station.stopIds.push(id);
      stationByStopId.set(id, station);
    });

    tripRows.forEach(row => {
      const tripId = String(row.trip_id || row.TRIP_ID || '').trim();
      const routeId = String(row.route_id || row.ROUTE_ID || '').trim();
      if (!tripId || !routeId) return;

      tripsById.set(tripId, {
        id: tripId,
        serviceId: String(row.service_id || row.SERVICE_ID || '').trim(),
        routeId,
        routeKey: normalizeRouteId(routeId),
        headsign: String(row.trip_headsign || row.TRIP_HEADSIGN || '').trim() || 'Direction inconnue',
        directionId: String(row.direction_id || row.DIRECTION_ID || '').trim()
      });
    });

    stopTimeRows.forEach(row => {
      const tripId = String(row.trip_id || row.TRIP_ID || '').trim();
      const stopId = String(row.stop_id || row.STOP_ID || '').trim();
      const trip = tripsById.get(tripId);
      const station = stationByStopId.get(stopId);
      if (!tripId || !stopId || !trip || !station || !isSupportedRouteId(trip.routeId)) return;

      const arrivalSeconds = parseGtfsTimeToSeconds(row.arrival_time || row.ARRIVAL_TIME);
      const departureSeconds = parseGtfsTimeToSeconds(row.departure_time || row.DEPARTURE_TIME);
      const sequence = Number(row.stop_sequence || row.STOP_SEQUENCE || 0);
      if (arrivalSeconds == null || !Number.isFinite(sequence)) return;

      const stopTime = {
        tripId,
        stopId,
        routeId: trip.routeId,
        routeKey: trip.routeKey,
        headsign: trip.headsign,
        directionId: trip.directionId,
        arrivalSeconds,
        departureSeconds: departureSeconds ?? arrivalSeconds,
        sequence
      };

      if (!stopTimesByStop.has(stopId)) stopTimesByStop.set(stopId, []);
      stopTimesByStop.get(stopId).push(stopTime);

      if (!stopTimesByTrip.has(tripId)) stopTimesByTrip.set(tripId, []);
      stopTimesByTrip.get(tripId).push(stopTime);

      station.lineSet.add(trip.routeId);
    });

    stopTimesByStop.forEach(times => {
      times.sort((left, right) => left.arrivalSeconds - right.arrivalSeconds);
    });
    stopTimesByTrip.forEach(times => {
      times.sort((left, right) => left.sequence - right.sequence);
    });

    const stations = Array.from(stationGroupsByKey.values()).map(station => {
      station.lineIds = Array.from(station.lineSet).sort(compareRouteIds);
      const lineSearch = station.lineIds
        .flatMap(routeId => [routeId, normalizeRouteId(routeId), getRouteDisplayName(routeId)])
        .join(' ');
      station.searchText = normalizeText(`${station.name} ${lineSearch}`);
      delete station.lineSet;
      return station;
    }).filter(station => station.lineIds.length > 0)
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'));

    return {
      stations,
      stopsById,
      tripsById,
      stopTimesByStop,
      stopTimesByTrip,
      stationByStopId
    };
  });

  return transitDataPromise;
}

export async function loadStationIndex() {
  const data = await loadTransitData();
  return data.stations;
}

function termLooksLikeRoute(value) {
  return /^[ABC]$/i.test(value) || /^E?\d{1,2}$/i.test(value);
}

function stationHasRoute(station, value) {
  const routeKey = normalizeRouteId(value);
  const displayName = normalizeText(getRouteDisplayName(value));
  return station.lineIds.some(routeId => (
    normalizeRouteId(routeId) === routeKey || normalizeText(getRouteDisplayName(routeId)) === displayName
  ));
}

export function stationMatchesQuery(station, query) {
  const rawTerms = String(query || '').trim().split(/\s+/).filter(Boolean);
  const terms = rawTerms.map(term => normalizeText(term));
  if (!terms.length) return true;
  return terms.every((term, index) => {
    const rawTerm = rawTerms[index];
    if (term === 'ligne' || term === 'lignes') return true;
    if (termLooksLikeRoute(rawTerm)) {
      return stationHasRoute(station, rawTerm);
    }
    return station.searchText.includes(term);
  });
}

async function fetchRealtimePayload() {
  const urls = [
    'http://localhost:5000/irigo.json',
    new URL(DATA_PATHS.realtimeFallback, import.meta.url).href
  ];
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn('Flux temps reel indisponible :', lastError);
  }
  return { vehicles: [] };
}

function getVehicleSequence(vehicle, tripTimes, stopsById) {
  const vehicleStopId = String(vehicle.stop_id || '').trim();
  if (vehicleStopId) {
    const matchingStopTime = tripTimes.find(stopTime => stopTime.stopId === vehicleStopId);
    if (matchingStopTime) return matchingStopTime;
  }

  const latitude = Number(vehicle.latitude);
  const longitude = Number(vehicle.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  let nearest = null;
  let nearestDistance = Infinity;
  tripTimes.forEach(stopTime => {
    const stop = stopsById.get(stopTime.stopId);
    if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return;
    const distance = haversineMeters(latitude, longitude, stop.lat, stop.lon);
    if (distance < nearestDistance) {
      nearest = stopTime;
      nearestDistance = distance;
    }
  });

  return nearestDistance <= 1600 ? nearest : null;
}

function createCandidateKey(candidate) {
  return `${candidate.routeKey}|${candidate.headsign}`;
}

function addPassageCandidate(rowsByKey, candidate) {
  if (!isSupportedRouteId(candidate.routeId)) return;

  const key = createCandidateKey(candidate);
  let row = rowsByKey.get(key);
  if (!row) {
    row = {
      key,
      routeId: candidate.routeId,
      routeKey: candidate.routeKey,
      headsign: candidate.headsign,
      candidatesByTrip: new Map()
    };
    rowsByKey.set(key, row);
  }

  const existing = row.candidatesByTrip.get(candidate.tripId);
  if (!existing || candidate.source === 'realtime' && existing.source !== 'realtime' || candidate.deltaSeconds < existing.deltaSeconds) {
    row.candidatesByTrip.set(candidate.tripId, candidate);
  }
}

function addTheoreticalCandidates(rowsByKey, station, data, nowSeconds, serviceDate) {
  station.stopIds.forEach(stopId => {
    const stopTimes = data.stopTimesByStop.get(stopId) || [];
    stopTimes.forEach(stopTime => {
      const trip = data.tripsById.get(stopTime.tripId);
      if (!trip || !isTripActiveForDate(trip, serviceDate)) return;

      const deltaSeconds = getNextDeltaSeconds(stopTime.arrivalSeconds, nowSeconds);
      addPassageCandidate(rowsByKey, {
        tripId: stopTime.tripId,
        routeId: trip.routeId,
        routeKey: trip.routeKey,
        headsign: trip.headsign,
        deltaSeconds,
        minutes: secondsToMinutes(deltaSeconds),
        source: 'theoretical'
      });
    });
  });
}

function addRealtimeCandidates(rowsByKey, station, data, vehicles) {
  const stationStopIds = new Set(station.stopIds);

  vehicles.forEach(vehicle => {
    const tripId = String(vehicle.trip_id || '').trim();
    const trip = data.tripsById.get(tripId);
    const tripTimes = data.stopTimesByTrip.get(tripId);
    if (!trip || !tripTimes || !tripTimes.length || !isSupportedRouteId(trip.routeId)) return;

    const vehicleSequence = getVehicleSequence(vehicle, tripTimes, data.stopsById);
    if (!vehicleSequence) return;

    const targetStopTime = tripTimes.find(stopTime => (
      stationStopIds.has(stopTime.stopId) && stopTime.sequence >= vehicleSequence.sequence
    ));
    if (!targetStopTime) return;

    let remainingSeconds = targetStopTime.arrivalSeconds - vehicleSequence.departureSeconds;
    while (remainingSeconds < 0) remainingSeconds += 24 * 3600;
    if (remainingSeconds > 4 * 3600) return;

    addPassageCandidate(rowsByKey, {
      tripId,
      routeId: trip.routeId,
      routeKey: trip.routeKey,
      headsign: trip.headsign,
      deltaSeconds: remainingSeconds,
      minutes: secondsToMinutes(remainingSeconds),
      source: 'realtime',
      vehicleId: String(vehicle.id || '')
    });
  });
}

function dedupePassageCandidates(candidates) {
  const realtimeDuplicateWindowSeconds = 10 * 60;
  const sameTimeDuplicateWindowSeconds = 60;
  const sorted = candidates.sort((left, right) => {
    if (left.deltaSeconds !== right.deltaSeconds) return left.deltaSeconds - right.deltaSeconds;
    if (left.source === right.source) return 0;
    return left.source === 'realtime' ? -1 : 1;
  });

  return sorted.reduce((kept, candidate) => {
    const duplicatesKeptCandidate = kept.some(existing => {
      const isSameTrip = existing.tripId === candidate.tripId;
      const isSameTime = Math.abs(existing.deltaSeconds - candidate.deltaSeconds) <= sameTimeDuplicateWindowSeconds;
      const isSameDisplayedMinute = existing.minutes === candidate.minutes;
      const isRealtimeSchedulePair = (existing.source === 'realtime' || candidate.source === 'realtime') &&
        Math.abs(existing.deltaSeconds - candidate.deltaSeconds) <= realtimeDuplicateWindowSeconds;

      return isSameTrip || isSameTime || isSameDisplayedMinute || isRealtimeSchedulePair;
    });

    if (!duplicatesKeptCandidate) {
      kept.push(candidate);
      return kept;
    }

    const duplicateIndex = kept.findIndex(existing => (
      existing.tripId === candidate.tripId ||
      Math.abs(existing.deltaSeconds - candidate.deltaSeconds) <= sameTimeDuplicateWindowSeconds ||
      existing.minutes === candidate.minutes ||
      ((existing.source === 'realtime' || candidate.source === 'realtime') &&
        Math.abs(existing.deltaSeconds - candidate.deltaSeconds) <= realtimeDuplicateWindowSeconds)
    ));
    const duplicate = kept[duplicateIndex];
    if (duplicate && candidate.source === 'realtime' && duplicate.source !== 'realtime') {
      kept[duplicateIndex] = candidate;
    }

    return kept;
  }, []);
}

export async function computeUpcomingPassages(stopId) {
  const data = await loadTransitData();
  const station = data.stationByStopId.get(String(stopId || '').trim());
  if (!station) {
    throw new Error('Arret introuvable');
  }

  const nowSeconds = getCurrentServiceSeconds();
  const rowsByKey = new Map();
  const payload = await fetchRealtimePayload();
  const vehicles = Array.isArray(payload?.vehicles) ? payload.vehicles : [];

  addTheoreticalCandidates(rowsByKey, station, data, nowSeconds, new Date());
  addRealtimeCandidates(rowsByKey, station, data, vehicles);

  const rows = Array.from(rowsByKey.values()).map(row => {
    const candidates = Array.from(row.candidatesByTrip.values());
    const realtimeCandidates = candidates.filter(candidate => candidate.source === 'realtime');
    const candidatesToDisplay = realtimeCandidates.length ? realtimeCandidates : candidates;
    const passages = dedupePassageCandidates(candidatesToDisplay)
      .slice(0, 2);
    return {
      routeId: row.routeId,
      routeKey: row.routeKey,
      lineName: getRouteDisplayName(row.routeId),
      headsign: row.headsign,
      passages
    };
  }).filter(row => row.passages.length > 0).sort((left, right) => {
    const routeCompare = compareRouteIds(left.routeId, right.routeId);
    if (routeCompare !== 0) return routeCompare;
    return left.headsign.localeCompare(right.headsign, 'fr');
  });

  return {
    station,
    rows,
    generatedAt: new Date()
  };
}
