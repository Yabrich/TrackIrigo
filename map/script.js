// Dynamically inject CSS for styled checkboxes
const styleEl = document.createElement('style');
styleEl.textContent = `
.checkbox-wrapper {
  --line-color: #483f91;
  display: flex;
  align-items: center;
  margin: 4px 0;
}
.checkbox-wrapper input[type="checkbox"] {
  opacity: 0;
  width: 0;
  height: 0;
}
.checkbox-wrapper label {
  position: relative;
  padding-left: 28px;
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  transition: transform 0.18s ease, color 0.18s ease;
}
.checkbox-wrapper label:before {
  content: '';
  position: absolute;
  left: 0;
  top: 2px;
  width: 20px;
  height: 20px;
  border: 2px solid var(--line-color, #888);
  border-radius: 6px;
  background: rgba(255,255,255,0.9);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05);
  transition: transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
}
.checkbox-wrapper input:checked + label {
  transform: translateY(-1px);
}
.checkbox-wrapper input:checked + label:before {
  background: var(--line-color, currentColor);
  border-color: var(--line-color, currentColor);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.18);
}
.checkbox-wrapper input:focus-visible + label:before {
  outline: 2px solid rgba(72, 63, 145, 0.45);
  outline-offset: 2px;
}
.checkbox-wrapper label .filter-line-label-text {
  flex: 1;
  font-weight: 600;
}
.checkbox-wrapper label .filter-line-count {
  transition: background 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
}
#toggle-all-btn {
  display: inline-block;
  width: 100%;
  padding: 8px 14px;
  margin: 8px 0 12px;
  background-color: #483f91;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0.02em;
  transition: background-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 4px 12px rgba(72, 63, 145, 0.35);
}
#toggle-all-btn:hover {
  background-color: #372d6e;
  transform: translateY(-1px);
}
#toggle-all-btn:active {
  transform: translateY(0);
}
body.dark-mode #toggle-all-btn {
  background-color: #555;
  color: #eee;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
}
body.dark-mode #toggle-all-btn:hover {
  background-color: #444;
}
`;
document.head.append(styleEl);

// =============================================
// 0. DONNÉES PRÉ-CALCULÉES (data/, générées par build_map_data.py)
// =============================================
// data/network.json est un petit index ; les arrêts, tracés et horaires sont dans
// des fichiers à empreinte (mis en cache par le navigateur) chargés à la demande.

const DATA_DIR = 'data/';

function fetchJson(url, options) {
  return fetch(url, options).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
    return res.json();
  });
}

function fetchDataFile(path) {
  if (!path) return Promise.reject(new Error('Fichier de données non référencé'));
  return fetchJson(DATA_DIR + path);
}

// "Encoded polyline" (précision 1e-5) -> [[lat, lon], ...]
function decodePolyline(encoded) {
  const points = [];
  if (!encoded) return points;
  let index = 0;
  let lat = 0;
  let lon = 0;
  const nextValue = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };
  while (index < encoded.length) {
    lat += nextValue();
    lon += nextValue();
    points.push([lat / 1e5, lon / 1e5]);
  }
  return points;
}

// =============================================
// 1. GESTION DU MODE SOMBRE (SUNRISE / SUNSET)
// =============================================

// Tile layers clair / sombre
let lightTileLayer, darkTileLayer;

// Fonction pour initialiser les deux tile layers
function initTileLayers() {
  lightTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 10,
    maxZoom: 18,
    attribution: '© OpenStreetMap'
  });
  darkTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_2qso_1_45914cb2a499efd2e0bb99d6', {
    minZoom: 10,
    maxZoom: 18,
    attribution: '© CartoDB Dark Matter'
  });
}

// Fonction qui détermine lever/coucher et applique le mode
function applyDayNightMode() {
  // On récupère le centre de la carte
  const center = map.getCenter();
  const lat = center.lat;
  const lng = center.lng;
  const now = new Date();

  // Obtenir les horaires du lever/coucher pour la date d’aujourd’hui
  const times = SunCalc.getTimes(now, lat, lng);
  const sunrise = times.sunrise;    // Date object
  const sunset  = times.sunset;     // Date object

  // Si on est entre le coucher et le lever du lendemain
  let isNight;
  if (now >= sunset) {
    // On se situe après le coucher => nuit
    isNight = true;
  } else if (now < sunrise) {
    // On se situe avant le lever => nuit
    isNight = true;
  } else {
    isNight = false;
  }

  // Appliquer le CSS et tileLayer correspondant
  if (isNight) {
    document.body.classList.add('dark-mode');
    if (map.hasLayer(lightTileLayer)) map.removeLayer(lightTileLayer);
    if (!map.hasLayer(darkTileLayer)) map.addLayer(darkTileLayer);
  } else {
    document.body.classList.remove('dark-mode');
    if (map.hasLayer(darkTileLayer)) map.removeLayer(darkTileLayer);
    if (!map.hasLayer(lightTileLayer)) map.addLayer(lightTileLayer);
  }

  // Planifier le prochain changement au prochain lever OU coucher
  let nextSwitchTime;
  if (isNight) {
    // Prochaine transition = lever du soleil
    nextSwitchTime = sunrise;
  } else {
    // Prochaine transition = coucher du soleil
    nextSwitchTime = sunset;
  }
  // Si la prochaine transition est déjà passée (ex. minuit), on prend celle du lendemain
  if (nextSwitchTime <= now) {
    const tomorrow = new Date(now.getTime() + 24*60*60*1000);
    const timesTmr = SunCalc.getTimes(tomorrow, lat, lng);
    nextSwitchTime = isNight ? timesTmr.sunrise : timesTmr.sunset;
  }
  // Calcul de l’intervalle avant la prochaine transition (en ms)
  const delayMs = nextSwitchTime.getTime() - now.getTime();
  setTimeout(applyDayNightMode, delayMs + 1000); // +1s pour être sûr
}


// ==================================
// 2. PERSISTANCE DES FILTRES (localStorage)
// ==================================

const urlParams = new URLSearchParams(window.location.search);
const requestedRoutesFromQuery = [
  urlParams.get('lines'),
  urlParams.get('line')
].filter(Boolean).flatMap(value => String(value).split(','));
const forcedRoutesFromQuery = new Set(requestedRoutesFromQuery.map(normalizeRouteId).filter(Boolean));
const forcedRouteFromQuery = forcedRoutesFromQuery.size ? Array.from(forcedRoutesFromQuery)[0] : '';
const targetMapLat = urlParams.has('lat') ? Number(urlParams.get('lat')) : NaN;
const targetMapLon = urlParams.has('lon') ? Number(urlParams.get('lon')) : NaN;
const targetMapZoom = Number(urlParams.get('zoom'));
const hasTargetMapCenter = Number.isFinite(targetMapLat) && Number.isFinite(targetMapLon);

function persistSelectedRoutes() {
  if (forcedRoutesFromQuery.size) return;
  localStorage.setItem('selectedRoutes', JSON.stringify(Array.from(selectedRoutes)));
}

function loadSelectedRoutes() {
  if (forcedRoutesFromQuery.size) {
    return new Set(forcedRoutesFromQuery);
  }
  const stored = localStorage.getItem('selectedRoutes');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const normalized = parsed.map(normalizeRouteId).filter(Boolean);
        if (normalized.length) {
          return new Set(normalized);
        }
      }
    } catch (e) {
      console.warn('Impossible de parser selectedRoutes dans localStorage :', e);
    }
  }
  const defaultRoutes = ['A','B','C','01','02','03','04'].map(normalizeRouteId);
  localStorage.setItem('selectedRoutes', JSON.stringify(defaultRoutes));
  return new Set(defaultRoutes);
}

let selectedRoutes = loadSelectedRoutes();
let stopsData = [];
let lineColors = {}; // Couleur par ligne
let stopNames = {}; // Nom par identifiant de station
let stopCoords = {}; // Coordonnées par station
const routesByKey = new Map(); // Clé de ligne normalisée -> entrées de network.json
let linesLayer;
let locateMarker; // Marker used for the "Me localiser" feature
let trackedBusId = null; // ID du bus actuellement suivi
let trackedPopupOpen = false;
let trackedBusLabel = null; // Label affiché pour le bus suivi
const DEFAULT_LINE_COLOR = '#4caf50';
const DEFAULT_TIMELINE_MESSAGE = 'Horaires indisponibles.';
const LOADING_TIMELINE_MESSAGE = 'Chargement des horaires…';
const DEFAULT_SPEED_M_S = 10;
const MIN_SPEED_M_S = 3;
const DELAY_THRESHOLD_SECONDS = 90;

function normalizeRouteId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const expressMatch = raw.match(/^E(\d{1,2})$/i);
  if (expressMatch) return expressMatch[1].padStart(2, '0');
  const isTwoDigitNumber = raw.length <= 2 && /^[0-9]+$/.test(raw);
  if (isTwoDigitNumber) return raw.padStart(2, '0');
  return raw.toUpperCase();
}

function normalizeHexColor(value, fallback = DEFAULT_LINE_COLOR) {
  const parse = input => {
    if (!input && input !== 0) return null;
    const hex = String(input).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return '#' + hex.toLowerCase();
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return '#' + hex.split('').map(ch => (ch + ch)).join('').toLowerCase();
    }
    return null;
  };
  return parse(value) ?? parse(fallback) ?? '#4caf50';
}

function computeBadgePalette(color) {
  const base = normalizeHexColor(color);
  const numeric = base.slice(1);
  const r = parseInt(numeric.slice(0, 2), 16);
  const g = parseInt(numeric.slice(2, 4), 16);
  const b = parseInt(numeric.slice(4, 6), 16);
  const rgba = alpha => 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const textColor = luminance > 0.62 ? '#1f1f1f' : '#ffffff';
  return {
    base,
    text: textColor,
    bg: rgba(0.18),
    activeBg: rgba(0.34),
    border: rgba(0.42),
    shadow: rgba(0.32)
  };
}

function applyCountBadgePalette(badge, palette) {
  if (!badge || !palette) return;
  badge.style.setProperty('--line-color', palette.base);
  badge.style.setProperty('--badge-bg', palette.bg);
  badge.style.setProperty('--badge-active-bg', palette.activeBg);
  badge.style.setProperty('--badge-border-color', palette.border);
  badge.style.setProperty('--badge-shadow-color', palette.shadow);
  badge.style.setProperty('--badge-color', palette.text);
}

// Gestion de l'affichage du message de suivi
const trackHintEl = document.getElementById('track_hint');
function updateTrackHint() {
  if (trackedBusId && trackedBusLabel) {
    trackHintEl.textContent = `Vous suivez le véhicule n°${trackedBusLabel}`;
  } else {
    trackHintEl.textContent = 'Cliquez sur un véhicule pour le suivre';
  }
}
updateTrackHint();

const filterPanelEl = document.getElementById('filter-panel');
const filterListEl = document.getElementById('filter-list');
const filterToggleBtn = document.getElementById('filter_toggle_btn');
const routeCountBadges = new Map();
let latestVehicleCounts = new Map();

function formatRouteLabel(routeId) {
  const numeric = Number(routeId);
  if (!Number.isNaN(numeric) && numeric >= 20 && numeric <= 25) {
    return `E${routeId}`;
  }
  return routeId;
}

function setFilterPanelOpen(isOpen) {
  if (!filterPanelEl) return;
  const open = Boolean(isOpen);
  filterPanelEl.classList.toggle('is-open', open);
  filterPanelEl.setAttribute('aria-hidden', (!open).toString());
  if (filterToggleBtn) {
    filterToggleBtn.setAttribute('aria-expanded', open.toString());
    filterToggleBtn.classList.toggle('is-active', open);
  }
}

setFilterPanelOpen(false);

if (filterToggleBtn) {
  filterToggleBtn.addEventListener('click', event => {
    event.stopPropagation();
    const shouldOpen = !(filterPanelEl && filterPanelEl.classList.contains('is-open'));
    setFilterPanelOpen(shouldOpen);
  });
}

document.addEventListener('click', event => {
  if (!filterPanelEl || !filterPanelEl.classList.contains('is-open')) return;
  if (filterPanelEl.contains(event.target)) return;
  if (filterToggleBtn && filterToggleBtn.contains(event.target)) return;
  setFilterPanelOpen(false);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    setFilterPanelOpen(false);
  }
});

function updateFilterVehicleCounts(countMap) {
  latestVehicleCounts = countMap instanceof Map
    ? new Map(countMap)
    : new Map(countMap ? countMap : []);
  routeCountBadges.forEach((badge, routeId) => {
    const count = latestVehicleCounts.get(routeId) ?? 0;
    badge.textContent = String(count);
    const hasVehicles = count > 0;
    badge.classList.toggle('is-active', hasVehicles);
    badge.style.opacity = hasVehicles ? '1' : '0.55';
    badge.setAttribute('data-count', String(count));
    const label = badge.closest('label');
    if (label) {
      const displayText = label.querySelector('.filter-line-label-text')?.textContent?.trim() || routeId;
      const suffix = count > 1 ? 'véhicules' : 'véhicule';
      badge.setAttribute('title', `${count} ${suffix}`);
      label.setAttribute('aria-label', `${displayText} – ${count} ${suffix} en service`);
    }
  });
}

const loadingOverlay = document.getElementById('loading-overlay');
const loadingOverlaySpinner = loadingOverlay ? loadingOverlay.querySelector('.loading-spinner') : null;
const loadingOverlayText = loadingOverlay ? loadingOverlay.querySelector('.loading-text') : null;

const vehicleInfoPanel = document.getElementById('vehicle-info-panel');
const vehicleInfoToggle = vehicleInfoPanel ? vehicleInfoPanel.querySelector('[data-vehicle-info-toggle]') : null;
const vehicleInfoBadge = vehicleInfoPanel ? vehicleInfoPanel.querySelector('.vehicle-info-badge') : null;
const vehicleInfoClose = vehicleInfoPanel ? vehicleInfoPanel.querySelector('[data-vehicle-info-close]') : null;
const TRAM_VEHICLE_BADGE_LABEL = 'Tramway n°';
const BUS_VEHICLE_BADGE_LABEL = 'Bus n°';
const DEFAULT_VEHICLE_BADGE_LABEL = BUS_VEHICLE_BADGE_LABEL;
const TRAM_LINE_CODES = new Set(['A','B','C']);

if (vehicleInfoBadge) {
  vehicleInfoBadge.textContent = DEFAULT_VEHICLE_BADGE_LABEL;
}

const vehicleInfoFields = vehicleInfoPanel ? {
  id: vehicleInfoPanel.querySelector('[data-vehicle-field="id"]'),
  line: vehicleInfoPanel.querySelector('[data-vehicle-field="line"]'),
  destination: vehicleInfoPanel.querySelector('[data-vehicle-field="destination"]'),
  nextStop: vehicleInfoPanel.querySelector('[data-vehicle-field="next-stop"]')
} : {};
const vehicleTimelineElements = vehicleInfoPanel ? {
  container: vehicleInfoPanel.querySelector('[data-vehicle-timeline-container]'),
  steps: vehicleInfoPanel.querySelector('[data-vehicle-field="timeline"]'),
  placeholder: vehicleInfoPanel.querySelector('[data-vehicle-timeline-placeholder]'),
  toggleButton: vehicleInfoPanel.querySelector('[data-vehicle-timeline-toggle]')
} : {};

const vehicleTimelineState = {
  isExpanded: false,
  data: null,
  message: DEFAULT_TIMELINE_MESSAGE,
  key: null
};

if (vehicleTimelineElements.toggleButton) {
  vehicleTimelineElements.toggleButton.addEventListener('click', () => {
    if (!vehicleTimelineState.data) return;
    vehicleTimelineState.isExpanded = !vehicleTimelineState.isExpanded;
    renderVehicleTimeline(
      vehicleTimelineState.data,
      vehicleTimelineState.message,
      { key: vehicleTimelineState.key, preserveState: true }
    );
  });
}

const vehicleInfoUIState = {
  isCollapsed: false
};

function applyVehicleInfoCollapseState() {
  if (!vehicleInfoPanel) return;
  const isEmpty = vehicleInfoPanel.classList.contains('is-empty');
  const shouldCollapse = vehicleInfoUIState.isCollapsed && !isEmpty;
  vehicleInfoPanel.classList.toggle('is-collapsed', shouldCollapse);
  if (vehicleInfoToggle) {
    vehicleInfoToggle.disabled = isEmpty;
    vehicleInfoToggle.setAttribute('aria-expanded', String(!shouldCollapse));
  }
}

if (vehicleInfoToggle) {
  vehicleInfoToggle.addEventListener('click', () => {
    if (vehicleInfoPanel.classList.contains('is-empty')) return;
    vehicleInfoUIState.isCollapsed = !vehicleInfoUIState.isCollapsed;
    applyVehicleInfoCollapseState();
  });
}

if (vehicleInfoClose) {
  vehicleInfoClose.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    clearVehicleInfoPanel();
  });
}

applyVehicleInfoCollapseState();

let selectedVehicleId = null;
let selectedVehicleContext = null; // { vehicle, routeKey, busLabel } du véhicule affiché

function setVehicleInfoField(element, value) {
  if (!element) return;
  const safeValue = value != null && value !== '' ? value : '-';
  element.textContent = safeValue;
}

function renderVehicleTimeline(timelineData, message, options = {}) {
  if (!vehicleTimelineElements.container || !vehicleTimelineElements.steps) return;
  const { container, steps, placeholder, toggleButton } = vehicleTimelineElements;

  const key = options && options.key != null ? String(options.key) : null;
  const preserveState = !!(options && options.preserveState);
  const keyChanged = key !== vehicleTimelineState.key;

  if (!preserveState) {
    if (keyChanged) {
      vehicleTimelineState.isExpanded = false;
    } else if (!key && timelineData !== vehicleTimelineState.data) {
      vehicleTimelineState.isExpanded = false;
    }
  }

  vehicleTimelineState.key = key;
  vehicleTimelineState.data = timelineData;

  steps.innerHTML = '';

  let baseItems = null;
  let allItems = null;
  let fallbackMessage = message;

  if (timelineData) {
    if (Array.isArray(timelineData)) {
      baseItems = timelineData;
      allItems = timelineData;
    } else {
      baseItems = Array.isArray(timelineData.items) ? timelineData.items : null;
      allItems = Array.isArray(timelineData.allItems) ? timelineData.allItems : baseItems;
      if (!fallbackMessage && timelineData.message) {
        fallbackMessage = timelineData.message;
      }
    }
  }

  const resolvedMessage = fallbackMessage || DEFAULT_TIMELINE_MESSAGE;
  vehicleTimelineState.message = resolvedMessage;

  const shouldExpand = vehicleTimelineState.isExpanded && allItems && allItems.length;
  const itemsToRender = shouldExpand ? allItems : baseItems;
  const hasItems = Array.isArray(itemsToRender) && itemsToRender.length > 0;

  if (!hasItems) {
    container.classList.remove('has-data');
    container.classList.remove('is-expanded');
    vehicleTimelineState.isExpanded = false;
    if (placeholder) {
      placeholder.textContent = resolvedMessage;
    }
    if (toggleButton) {
      toggleButton.classList.add('is-hidden');
      toggleButton.removeAttribute('aria-expanded');
    }
    return;
  }

  container.classList.add('has-data');
  container.classList.toggle('is-expanded', !!shouldExpand);
  if (placeholder) {
    placeholder.textContent = '';
  }

  itemsToRender.forEach((item, index) => {
    if (!item) return;
    const stepEl = document.createElement('div');
    const statusClass = item && item.status ? ` is-${item.status}` : '';
    stepEl.className = `vehicle-timeline-step${statusClass}`;

    const axisEl = document.createElement('div');
    axisEl.className = 'vehicle-timeline-axis';

    const topLine = document.createElement('span');
    topLine.className = 'vehicle-timeline-axis-line';
    if (index === 0) {
      topLine.classList.add('is-hidden');
    } else {
      const prevItem = itemsToRender[index - 1];
      if (prevItem && prevItem.status === 'past') {
        topLine.classList.add('is-past');
      } else {
        topLine.classList.add('is-colored');
      }
    }

    const dot = document.createElement('span');
    dot.className = 'vehicle-timeline-dot';

    const bottomLine = document.createElement('span');
    bottomLine.className = 'vehicle-timeline-axis-line';
    if (index === itemsToRender.length - 1) {
      bottomLine.classList.add('is-hidden');
    } else if (item && item.status === 'past') {
      bottomLine.classList.add('is-past');
    } else {
      bottomLine.classList.add('is-colored');
    }

    axisEl.append(topLine, dot, bottomLine);

    const stopEl = document.createElement('div');
    stopEl.className = 'vehicle-timeline-stop';

    const nameEl = document.createElement('span');
    nameEl.className = 'vehicle-timeline-name';
    nameEl.textContent = item && item.name ? item.name : '-';

    const timeEl = document.createElement('div');
    timeEl.className = 'vehicle-timeline-time';

    const scheduledSpan = document.createElement('span');
    scheduledSpan.className = 'vehicle-timeline-time-scheduled';
    scheduledSpan.textContent = item && item.scheduledText ? item.scheduledText : (item && item.time ? item.time : '-');

    if (item && item.showEta && item.etaText) {
      scheduledSpan.classList.add('is-overridden');
      const etaSpan = document.createElement('span');
      etaSpan.className = 'vehicle-timeline-time-eta';
      if (item.isEarly) etaSpan.classList.add('is-early');
      if (item.isLate) etaSpan.classList.add('is-late');
      etaSpan.textContent = item.etaText;
      timeEl.append(scheduledSpan, etaSpan);
    } else {
      timeEl.appendChild(scheduledSpan);
    }

    stopEl.append(nameEl, timeEl);
    stepEl.append(axisEl, stopEl);
    steps.appendChild(stepEl);
  });

  if (toggleButton) {
    const canExpand = allItems && baseItems && allItems.length > baseItems.length;
    toggleButton.classList.toggle('is-hidden', !canExpand);
    if (canExpand) {
      const expanded = !!shouldExpand;
      toggleButton.textContent = expanded ? 'Réduire les arrêts' : 'Charger plus d’arrêts';
      toggleButton.setAttribute('aria-expanded', String(expanded));
    } else {
      toggleButton.removeAttribute('aria-expanded');
    }
  }
}


function resolveVehicleBadgeLabel(lineValue) {
  const normalized = typeof lineValue === 'string'
    ? lineValue.trim().toUpperCase()
    : lineValue != null
      ? String(lineValue).trim().toUpperCase()
      : '';
  if (!normalized) return DEFAULT_VEHICLE_BADGE_LABEL;
  return TRAM_LINE_CODES.has(normalized) ? TRAM_VEHICLE_BADGE_LABEL : BUS_VEHICLE_BADGE_LABEL;
}

function updateVehicleInfoPanel(info) {
  if (!vehicleInfoPanel) return;
  vehicleInfoPanel.classList.remove('is-empty');
  const payload = info || {};
  setVehicleInfoField(vehicleInfoFields.id, payload.id);
  setVehicleInfoField(vehicleInfoFields.line, payload.line);
  if (vehicleInfoBadge) {
    vehicleInfoBadge.textContent = resolveVehicleBadgeLabel(payload.line);
  }
  setVehicleInfoField(vehicleInfoFields.destination, payload.destination);
  setVehicleInfoField(vehicleInfoFields.nextStop, payload.nextStop);
  const lineColor = payload.lineColor || DEFAULT_LINE_COLOR;
  vehicleInfoPanel.style.setProperty('--vehicle-line-color', lineColor);
  const timelineData = payload.timeline;
  const timelineMessage = payload.timelineMessage || (timelineData && timelineData.message);
  const timelineKey = payload.timelineKey != null ? String(payload.timelineKey) : (payload.id != null ? String(payload.id) : null);
  renderVehicleTimeline(timelineData, timelineMessage, { key: timelineKey });
  applyVehicleInfoCollapseState();
}

function handleVehicleSelection(vehicleId, info) {
  selectedVehicleId = vehicleId;
  updateVehicleInfoPanel(info);
}

function clearVehicleInfoPanel() {
  if (!vehicleInfoPanel) return;
  selectedVehicleId = null;
  vehicleInfoPanel.classList.add('is-empty');
  vehicleInfoPanel.style.setProperty('--vehicle-line-color', DEFAULT_LINE_COLOR);
  setVehicleInfoField(vehicleInfoFields.id, '-');
  setVehicleInfoField(vehicleInfoFields.line, '-');
  setVehicleInfoField(vehicleInfoFields.destination, '-');
  setVehicleInfoField(vehicleInfoFields.nextStop, '-');
  if (vehicleInfoBadge) {
    vehicleInfoBadge.textContent = DEFAULT_VEHICLE_BADGE_LABEL;
  }
  vehicleTimelineState.isExpanded = false;
  vehicleTimelineState.data = null;
  vehicleTimelineState.key = null;
  vehicleTimelineState.message = DEFAULT_TIMELINE_MESSAGE;
  renderVehicleTimeline(null, DEFAULT_TIMELINE_MESSAGE);
  applyVehicleInfoCollapseState();
}

function hideLoadingOverlay() {
  if (!loadingOverlay) return;
  loadingOverlay.classList.add('is-hidden');
  setTimeout(() => {
    if (loadingOverlay.parentElement) {
      loadingOverlay.parentElement.removeChild(loadingOverlay);
    }
  }, 600);
}

function showLoadingOverlayError(message) {
  if (!loadingOverlay) return;
  if (loadingOverlaySpinner) loadingOverlaySpinner.classList.add('is-hidden');
  if (loadingOverlayText) loadingOverlayText.textContent = message || 'Impossible de charger les données.';
  loadingOverlay.classList.remove('is-hidden');
  loadingOverlay.classList.add('has-error');
}

function normalizeTimeValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const totalSeconds = Math.round(value * 86400);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  const str = String(value).trim();
  if (!str) return '';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    const [h, m, s = '00'] = str.split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
  }
  return str;
}

function formatGtfsTime(value) {
  if (value == null || value === '') return '-';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatGtfsTime(normalizeTimeValue(value));
  }
  const str = String(value).trim();
  if (!str) return '-';
  const parts = str.split(':');
  if (parts.length < 2) return str;
  let hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return str;
  const dayOffset = Math.floor(hours / 24);
  hours = ((hours % 24) + 24) % 24;
  const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  if (dayOffset > 0) {
    return `${formatted}+${dayOffset}`;
  }
  return formatted;
}

function toRadians(deg) {
  return deg * Math.PI / 180;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => v == null || Number.isNaN(v))) return null;
  const R = 6371000; // metres
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function timeStringToSeconds(str) {
  if (!str) return null;
  const parts = String(str).split(':');
  if (parts.length < 2) return null;
  const [h, m, s = '0'] = parts;
  const hours = Number(h);
  const minutes = Number(m);
  const seconds = Number(s);
  if ([hours, minutes, seconds].some(v => !Number.isFinite(v))) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function getSecondsSinceMidnight(date) {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function alignScheduleSeconds(value, referenceSeconds) {
  if (value == null) return null;
  if (referenceSeconds == null) return value;
  const DAY = 86400;
  let adjusted = value;
  while (adjusted - referenceSeconds < -DAY / 2) adjusted += DAY;
  while (adjusted - referenceSeconds > DAY / 2) adjusted -= DAY;
  return adjusted;
}

function formatClockFromAbsoluteSeconds(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '-';
  const DAY = 86400;
  let dayOffset = 0;
  let s = seconds;
  if (s < 0) {
    dayOffset = Math.ceil(-s / DAY);
    s += dayOffset * DAY;
    dayOffset = -dayOffset;
  } else if (s >= DAY) {
    dayOffset = Math.floor(s / DAY);
    s -= dayOffset * DAY;
  }
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return dayOffset ? `${formatted}+${dayOffset}` : formatted;
}

function getStopCoordinates(stopId) {
  if (stopId == null) return null;
  const key = String(stopId);
  if (stopCoords[key]) return stopCoords[key];
  const normalized = key.replace(/^0+/, '') || '0';
  if (stopCoords[normalized]) return stopCoords[normalized];
  return null;
}

function getStopDisplayName(stopId) {
  if (stopId == null) return '-';
  const raw = String(stopId);
  if (stopNames[raw]) return stopNames[raw];
  const normalized = raw.replace(/^0+/, '') || '0';
  return stopNames[normalized] || raw;
}

// Horaires : un fichier par ligne (data/trips), chargé au premier clic sur un
// véhicule de la ligne. Les courses y sont factorisées (suites d'arrêts et
// profils de temps communs) et ne sont développées qu'à la demande.
const routeTripsCache = new Map(); // Clé de ligne -> Promise
const routeTripsStatus = new Map(); // Clé de ligne -> 'loading' | 'ready' | 'error'
const tripIndex = new Map(); // trip_id (brut et sans zéros initiaux) -> { table, record }
const expandedTripStops = new WeakMap(); // record -> liste des arrêts développée

function registerTripTable(table) {
  const trips = table && table.trips ? table.trips : {};
  Object.keys(trips).forEach(tripId => {
    const ref = { table, record: trips[tripId] };
    tripIndex.set(tripId, ref);
    const tripIdNoZ = tripId.replace(/^0+/, '') || '0';
    if (!tripIndex.has(tripIdNoZ)) tripIndex.set(tripIdNoZ, ref);
  });
}

function loadRouteTrips(routeKey) {
  if (routeTripsCache.has(routeKey)) return routeTripsCache.get(routeKey);
  const routes = routesByKey.get(routeKey) || [];
  routeTripsStatus.set(routeKey, 'loading');
  const promise = Promise.all(routes
    .filter(route => route.trips)
    .map(route => fetchDataFile(route.trips).then(registerTripTable)))
    .then(() => {
      routeTripsStatus.set(routeKey, 'ready');
    }, err => {
      routeTripsStatus.set(routeKey, 'error');
      routeTripsCache.delete(routeKey); // nouvel essai au prochain clic
      console.warn(`Horaires de la ligne ${routeKey} indisponibles :`, err);
      throw err;
    });
  routeTripsCache.set(routeKey, promise);
  return promise;
}

function findTrip(tripId) {
  if (tripId == null) return null;
  const raw = String(tripId);
  return tripIndex.get(raw) || tripIndex.get(raw.replace(/^0+/, '') || '0') || null;
}

function secondsToGtfsTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// record = [profil, arrivée au 1er arrêt (s), destination] ;
// profil = [suite d'arrêts, temps de parcours entre arrêts, [indice, temps d'arrêt, ...]]
function expandTripStops(table, record) {
  const profile = table.profiles ? table.profiles[record[0]] : null;
  if (!profile) return [];
  const [patternIndex, travel = [], dwell = []] = profile;
  const pattern = (table.patterns && table.patterns[patternIndex]) || [];
  const dwellByIndex = new Map();
  for (let i = 0; i + 1 < dwell.length; i += 2) dwellByIndex.set(dwell[i], dwell[i + 1]);

  const stops = [];
  let clock = record[1];
  pattern.forEach((stopIndex, i) => {
    if (i > 0) clock += travel[i - 1] || 0;
    const arrivalSeconds = clock;
    clock += dwellByIndex.get(i) || 0;
    const departureSeconds = clock;
    stops.push({
      stopId: String(table.stops[stopIndex]),
      sequence: i,
      departureTime: secondsToGtfsTime(departureSeconds),
      arrivalTime: secondsToGtfsTime(arrivalSeconds),
      departureSeconds,
      arrivalSeconds
    });
  });
  return stops;
}

function getTripStopsByTripId(tripId) {
  const trip = findTrip(tripId);
  if (!trip) return null;
  let stops = expandedTripStops.get(trip.record);
  if (!stops) {
    stops = expandTripStops(trip.table, trip.record);
    expandedTripStops.set(trip.record, stops);
  }
  return stops;
}

function getTripHeadsign(tripId) {
  const trip = findTrip(tripId);
  if (!trip || !Array.isArray(trip.table.headsigns)) return null;
  return trip.table.headsigns[trip.record[2]] ?? null;
}

function buildVehicleTimelineData(tripId, nextStopId, fallbackStopId, vehiclePosition, referenceSeconds) {
  const stops = getTripStopsByTripId(tripId);
  if (!stops || !stops.length) {
    return { items: null, allItems: null, message: DEFAULT_TIMELINE_MESSAGE };
  }

  const candidates = [];
  const pushCandidate = value => {
    if (value == null || value === '') return;
    const str = String(value);
    if (!str) return;
    candidates.push(str);
    const trimmed = str.replace(/^0+/, '') || '0';
    if (trimmed !== str) candidates.push(trimmed);
  };
  pushCandidate(nextStopId);
  pushCandidate(fallbackStopId);

  let currentIndex = -1;
  for (const candidate of candidates) {
    currentIndex = stops.findIndex(entry => entry.stopId === candidate);
    if (currentIndex !== -1) break;
  }
  if (currentIndex === -1) {
    currentIndex = 0;
  }

  const createEntry = (stop, status) => {
    if (!stop) return null;
    const stopId = stop.stopId;
    if (!stopId) return null;
    const scheduledRaw = stop.departureTime || stop.arrivalTime || '';
    const scheduledSeconds = stop.departureSeconds != null
      ? stop.departureSeconds
      : (stop.arrivalSeconds != null ? stop.arrivalSeconds : timeStringToSeconds(scheduledRaw));
    return {
      status,
      stopId,
      name: getStopDisplayName(stopId),
      scheduledRaw,
      scheduledSeconds,
      scheduledText: formatGtfsTime(scheduledRaw),
      rawStop: stop
    };
  };

  const fullItems = [];
  stops.forEach((stop, idx) => {
    const status = idx < currentIndex ? 'past' : (idx === currentIndex ? 'current' : 'upcoming');
    const entry = createEntry(stop, status);
    if (entry) {
      fullItems.push(entry);
    }
  });

  if (!fullItems.length) {
    return { items: null, allItems: null, message: DEFAULT_TIMELINE_MESSAGE };
  }

  if (!fullItems.some(item => item.status === 'current')) {
    const lastItem = fullItems[fullItems.length - 1];
    if (lastItem) {
      lastItem.status = 'current';
    }
  }

  const summaryItems = [];
  if (currentIndex > 0 && fullItems[currentIndex - 1]) {
    summaryItems.push(fullItems[currentIndex - 1]);
  }

  const MAX_VISIBLE_UPCOMING = 4;
  let upcomingCount = 0;
  for (let idx = Math.max(currentIndex, 0); idx < fullItems.length && upcomingCount < MAX_VISIBLE_UPCOMING; idx++) {
    const entry = fullItems[idx];
    if (!entry) continue;
    summaryItems.push(entry);
    upcomingCount++;
  }

  const nowSeconds = Number.isFinite(referenceSeconds) ? referenceSeconds : getSecondsSinceMidnight(new Date());
  const currentEntry = fullItems[currentIndex] || fullItems.find(item => item.status === 'current') || null;
  const pastEntry = currentIndex > 0 ? fullItems[currentIndex - 1] : null;

  let etaBaseSeconds = null;
  let delaySeconds = null;
  let distanceToCurrent = null;

  if (currentEntry && vehiclePosition && Number.isFinite(vehiclePosition.lat) && Number.isFinite(vehiclePosition.lon)) {
    const currentCoords = getStopCoordinates(currentEntry.stopId);
    if (currentCoords) {
      distanceToCurrent = haversineDistance(vehiclePosition.lat, vehiclePosition.lon, currentCoords.lat, currentCoords.lon);
      if (distanceToCurrent != null) {
        let segmentSpeed = DEFAULT_SPEED_M_S;
        if (pastEntry && pastEntry.rawStop) {
          const prevCoords = getStopCoordinates(pastEntry.stopId);
          const prevSeconds = pastEntry.rawStop.departureSeconds ?? pastEntry.rawStop.arrivalSeconds ?? null;
          const currentSeconds = currentEntry.rawStop.arrivalSeconds ?? currentEntry.rawStop.departureSeconds ?? null;
          let segmentSeconds = null;
          if (currentSeconds != null && prevSeconds != null) {
            segmentSeconds = currentSeconds - prevSeconds;
            if (segmentSeconds <= 0) segmentSeconds += 86400;
          }
          if (prevCoords) {
            const segmentDistance = haversineDistance(prevCoords.lat, prevCoords.lon, currentCoords.lat, currentCoords.lon);
            if (segmentDistance && segmentSeconds && segmentSeconds > 0) {
              const computedSpeed = segmentDistance / segmentSeconds;
              if (computedSpeed > 0.5) {
                segmentSpeed = Math.min(Math.max(computedSpeed, MIN_SPEED_M_S), 35);
              }
            }
          }
        }
        const speed = Math.max(segmentSpeed, MIN_SPEED_M_S);
        let travelSeconds = 0;
        if (distanceToCurrent > 5) {
          travelSeconds = distanceToCurrent / speed;
          if (!Number.isFinite(travelSeconds) || travelSeconds < 0) travelSeconds = 0;
        }
        etaBaseSeconds = nowSeconds + travelSeconds;
        const scheduledSeconds = alignScheduleSeconds(currentEntry.scheduledSeconds, nowSeconds);
        if (scheduledSeconds != null) {
          delaySeconds = etaBaseSeconds - scheduledSeconds;
          currentEntry.etaSeconds = etaBaseSeconds;
          currentEntry.etaText = formatClockFromAbsoluteSeconds(etaBaseSeconds);
          currentEntry.showEta = Math.abs(delaySeconds) > DELAY_THRESHOLD_SECONDS;
          currentEntry.isLate = delaySeconds > DELAY_THRESHOLD_SECONDS;
          currentEntry.isEarly = delaySeconds < -DELAY_THRESHOLD_SECONDS;
          currentEntry.delaySeconds = delaySeconds;
          currentEntry.scheduledAligned = scheduledSeconds;
        }
      }
    }
  }

  const isAtTripOrigin = currentEntry && !pastEntry && distanceToCurrent != null && distanceToCurrent < 40
    && ((currentEntry.rawStop && Number.isFinite(currentEntry.rawStop.sequence)
      && currentEntry.rawStop.sequence <= 1) || currentIndex <= 0);
  if (isAtTripOrigin && delaySeconds != null && delaySeconds < -DELAY_THRESHOLD_SECONDS) {
    delaySeconds = 0;
    if (currentEntry) {
      currentEntry.showEta = false;
      currentEntry.isEarly = false;
      currentEntry.delaySeconds = 0;
    }
  }

  fullItems.forEach(item => {
    item.scheduledText = item.scheduledText || formatGtfsTime(item.scheduledRaw);
    if (item.status === 'past') {
      item.showEta = false;
      return;
    }
    if (delaySeconds != null && item.scheduledSeconds != null && etaBaseSeconds != null) {
      const aligned = alignScheduleSeconds(item.scheduledSeconds, nowSeconds);
      if (aligned != null) {
        const etaSeconds = aligned + delaySeconds;
        item.etaSeconds = etaSeconds;
        item.etaText = formatClockFromAbsoluteSeconds(etaSeconds);
        const diff = Math.abs(etaSeconds - aligned);
        item.showEta = diff > DELAY_THRESHOLD_SECONDS;
        item.isLate = etaSeconds - aligned > DELAY_THRESHOLD_SECONDS;
        item.isEarly = aligned - etaSeconds > DELAY_THRESHOLD_SECONDS;
        item.delaySeconds = etaSeconds - aligned;
      }
    }
  });

  fullItems.forEach(item => {
    if (item.showEta && !item.etaText) {
      item.showEta = false;
    }
  });

  return {
    items: summaryItems,
    allItems: fullItems
  };
}
// Le panneau n'est calculé que pour le véhicule sélectionné ; les horaires de sa
// ligne sont chargés au premier clic, puis le panneau est rafraîchi.
function buildVehicleInfoPayload(context) {
  const { vehicle: v, routeKey, busLabel } = context;
  const tripKey = v.trip_id != null ? String(v.trip_id) : '';
  const tripsStatus = routeTripsStatus.get(routeKey);
  const tripsPending = tripsStatus !== 'ready' && tripsStatus !== 'error';
  const nextStopId = v.next_stop != null ? v.next_stop : v.stop_id;
  const timeline = tripsPending
    ? { items: null, allItems: null, message: LOADING_TIMELINE_MESSAGE }
    : buildVehicleTimelineData(
      tripKey,
      nextStopId,
      v.stop_id,
      { lat: Number(v.latitude), lon: Number(v.longitude) },
      getSecondsSinceMidnight(new Date())
    );
  return {
    id: busLabel,
    line: formatRouteLabel(routeKey) || '-',
    destination: tripsPending ? '…' : (getTripHeadsign(tripKey) ?? '-'),
    nextStop: getStopDisplayName(nextStopId),
    lineColor: normalizeHexColor(lineColors[routeKey]),
    timeline,
    timelineMessage: timeline ? timeline.message : undefined,
    timelineKey: v.id != null ? String(v.id) : null
  };
}

function refreshSelectedVehicleInfo() {
  const context = selectedVehicleContext;
  if (!context || selectedVehicleId == null || selectedVehicleId !== context.vehicle.id) return;
  updateVehicleInfoPanel(buildVehicleInfoPayload(context));
}

function showVehicleInfo(context, isNewSelection) {
  selectedVehicleContext = context;
  const tripsStatus = routeTripsStatus.get(context.routeKey);
  if (tripsStatus !== 'ready' && (tripsStatus !== 'error' || isNewSelection)) {
    loadRouteTrips(context.routeKey).then(refreshSelectedVehicleInfo, refreshSelectedVehicleInfo);
  }
  const payload = buildVehicleInfoPayload(context);
  if (isNewSelection) {
    handleVehicleSelection(context.vehicle.id, payload);
  } else {
    updateVehicleInfoPanel(payload);
  }
}

if (vehicleInfoPanel) {
  document.addEventListener('click', event => {
    if (vehicleInfoPanel.classList.contains('is-empty')) return;
    const target = event.target;
    if (vehicleInfoPanel.contains(target)) return;
    if (target.closest('.leaflet-popup') || target.closest('.leaflet-marker-icon')) return;
    if (target.closest('.leaflet-control') || target.closest('.maptool-ignore-close')) return;
    if (target.closest('#map')) return;
    clearVehicleInfoPanel();
  });
}


// ==================================
// 3. INITIALISATION DE LA CARTE
// ==================================

const map = L.map('map').setView([47.4736, -0.5541], 13);

initTileLayers();
map.addLayer(lightTileLayer);
applyDayNightMode();


// ==================================
// 3bis. TRACÉS DES LIGNES (data/shapes, un fichier par ligne)
// ==================================

// Nombre de jours explorés pour retrouver un tracé en service pour chaque ligne.
const SHAPE_LOOKAHEAD_DAYS = 14;
let networkHasServiceSoon = true;

// Indice du jour `date` (heure locale) dans un calendrier commençant le `base` (AAAAMMJJ).
function gtfsDayIndex(base, date) {
  if (!/^\d{8}$/.test(base || '')) return null;
  const baseUtc = Date.UTC(Number(base.slice(0, 4)), Number(base.slice(4, 6)) - 1, Number(base.slice(6, 8)));
  const dayUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((dayUtc - baseUtc) / 86400000);
}

// Jours de circulation encodés en hexadécimal : 4 jours par caractère, bit de poids fort en premier.
function isDayActive(hexDays, dayIndex) {
  if (!hexDays || dayIndex == null || dayIndex < 0) return false;
  const digit = parseInt(hexDays.charAt(dayIndex >> 2), 16);
  return Number.isFinite(digit) && ((digit >> (3 - (dayIndex & 3))) & 1) === 1;
}

// Faux si aucune ligne ne circule dans les prochains jours (calendrier expiré ou
// illisible) : on affiche alors tous les tracés.
function hasServiceInLookahead(network) {
  const todayIndex = gtfsDayIndex(network.base, new Date());
  if (todayIndex == null) return false;
  for (let offset = 0; offset < SHAPE_LOOKAHEAD_DAYS; offset++) {
    if (isDayActive(network.active, todayIndex + offset)) return true;
  }
  return false;
}

// Tracés réellement exploités : ceux du jour ; une ligne qui ne circule pas
// aujourd'hui (dimanche, ligne scolaire...) prend ceux du premier jour suivant où
// elle circule. Cela évite d'afficher côte à côte l'ancien et le nouveau tracé
// d'une même ligne.
function selectShapesInService(shapeFile) {
  const shapes = shapeFile && Array.isArray(shapeFile.shapes) ? shapeFile.shapes : [];
  if (!networkHasServiceSoon) return shapes;
  const todayIndex = gtfsDayIndex(shapeFile.base, new Date());
  if (todayIndex == null) return shapes;
  for (let offset = 0; offset < SHAPE_LOOKAHEAD_DAYS; offset++) {
    const running = shapes.filter(shape => isDayActive(shape[1], todayIndex + offset));
    if (running.length) return running;
  }
  return [];
}

const routeLinesCache = new Map(); // Clé de ligne -> Promise<[{ routeKey, shapeId, color, longName, latlngs }]>

function loadRouteLines(routeKey) {
  if (routeLinesCache.has(routeKey)) return routeLinesCache.get(routeKey);
  const routes = routesByKey.get(routeKey) || [];
  const promise = Promise.all(routes
    .filter(route => route.shapes)
    .map(route => fetchDataFile(route.shapes).then(shapeFile =>
      selectShapesInService(shapeFile)
        .map(([shapeId, , encoded]) => ({
          routeKey,
          shapeId,
          color: normalizeHexColor(route.color),
          longName: route.name || '',
          latlngs: decodePolyline(encoded)
        }))
        .filter(line => line.latlngs.length >= 2)
    )))
    .then(groups => groups.flat());
  routeLinesCache.set(routeKey, promise);
  promise.catch(err => {
    routeLinesCache.delete(routeKey); // nouvel essai au prochain affichage
    console.warn(`Tracé de la ligne ${routeKey} indisponible :`, err);
  });
  return promise;
}


// ==================================
// 4. DESSIN DES LIGNES FILTRÉES
// ==================================

let linesRenderToken = 0;

function updateLines() {
  const token = ++linesRenderToken;
  const routeKeys = Array.from(selectedRoutes);
  return Promise.all(routeKeys.map(routeKey => loadRouteLines(routeKey).catch(() => [])))
    .then(groups => {
      if (token !== linesRenderToken) return; // sélection modifiée entre-temps
      if (linesLayer) map.removeLayer(linesLayer);

      const polylines = [];
      groups.flat().forEach(line => {
        const polyline = L.polyline(line.latlngs, {
          color: line.color,
          weight: 3,
          opacity: 0.7
        });
        const label = formatRouteLabel(line.routeKey);
        polyline.bindPopup(`Ligne ${label}${line.longName ? ` – ${line.longName}` : ''}`);
        polylines.push(polyline);
      });
      linesLayer = L.featureGroup(polylines).addTo(map);

      if (forcedRoutesFromQuery.size && !hasTargetMapCenter && linesLayer.getLayers().length > 0) {
        const bounds = linesLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20] });
        }
      }
    });
}


// ==================================
// 5. ICÔNES BUS / TRAM
// ==================================

function getBusIcon(color) {
  return L.divIcon({
    className: '',
    html: `<i class="fas fa-bus" style="color:#${color};font-size:24px;text-shadow:0 0 3px #000;"></i>`,
    iconSize: [24,24],
    iconAnchor: [12,12]
  });
}
function getTramIcon(color) {
  /*const hex = /^[0-9a-f]{3,8}$/i.test(color) ? color : 'ff0000';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 448 512"
         width="24" height="24"
         style="display:block">
      <path fill="#${hex}"
            stroke="#ffffff"
            stroke-width="28"
            paint-order="stroke fill"
            d="M86.8 48c-12.2 0-23.6 5.5-31.2 15L42.7 79C34.5 89.3 19.4 91 9 82.7S-3 59.4 5.3 49L18 33C34.7 12.2 60 0 86.8 0L361.2 0c26.7 0 52 12.2 68.7 33l12.8 16c8.3 10.4 6.6 25.5-3.8 33.7s-25.5 6.6-33.7-3.7L392.5 63c-7.6-9.5-19.1-15-31.2-15L248 48l0 48 40 0c53 0 96 43 96 96l0 160c0 30.6-14.3 57.8-36.6 75.4l65.5 65.5c7.1 7.1 2.1 19.1-7.9 19.1l-39.7 0c-8.5 0-16.6-3.4-22.6-9.4L288 448l-128 0-54.6 54.6c-6 6-14.1 9.4-22.6 9.4L43 512c-10 0-15-12.1-7.9-19.1l65.5-65.5C78.3 409.8 64 382.6 64 352l0-160c0-53 43-96 96-96l40 0 0-48L86.8 48zM160 160c-17.7 0-32 14.3-32 32l0 32c0 17.7 14.3 32 32 32l128 0c17.7 0 32-14.3 32-32l0-32c0-17.7-14.3-32-32-32l-128 0zm32 192a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zm96 32a32 32 0 1 0 0-64 32 32 0 1 0 0 64z"/>
    </svg>
  `.trim();

  return L.divIcon({
    className: '',
    html: svg,
    iconSize: [28,28],
    iconAnchor: [14,14]
  });*/
  return L.divIcon({
    className: '',
    html: `<i class="fas fa-train-tram" style="color:#${color};font-size:26px;text-shadow:0 0 3px #000;"></i>`,
    iconSize: [24,24],
    iconAnchor: [12,12]
  });
}




// ==================================
// 6. CHARGEMENT DES DONNÉES (ARRÊTS + LIGNES)
// ==================================

// Arrêts : colonnes id / name + coordonnées en "encoded polyline".
function applyStopsFile(stopsFile) {
  const ids = stopsFile && Array.isArray(stopsFile.id) ? stopsFile.id : [];
  const names = stopsFile && Array.isArray(stopsFile.name) ? stopsFile.name : [];
  const coords = decodePolyline(stopsFile && stopsFile.coords);
  const withoutCoords = new Set(stopsFile && Array.isArray(stopsFile.noCoords) ? stopsFile.noCoords : []);
  stopsData = ids.map((stopId, i) => {
    const point = withoutCoords.has(i) ? null : coords[i];
    return {
      stop_id: stopId,
      stop_name: names[i],
      stop_coordinates: point ? { lat: point[0], lon: point[1] } : { lat: NaN, lon: NaN }
    };
  });

  // Construire stopNames/coords
  stopsData.forEach(s => {
    if (!s || s.stop_id == null) return;
    const sid = String(s.stop_id);
    const sidNoZ = sid.replace(/^0+/, '') || '0';
    stopNames[sid] = s.stop_name;
    if (!(sidNoZ in stopNames)) stopNames[sidNoZ] = s.stop_name;
    if (s.stop_coordinates && Number.isFinite(s.stop_coordinates.lat) && Number.isFinite(s.stop_coordinates.lon)) {
      const coords = { lat: Number(s.stop_coordinates.lat), lon: Number(s.stop_coordinates.lon) };
      stopCoords[sid] = coords;
      if (!(sidNoZ in stopCoords)) stopCoords[sidNoZ] = coords;
    }
  });
}

// network.json : lignes (couleur, nom, fichiers de tracés / horaires) et calendrier global.
function applyNetworkIndex(network) {
  routesByKey.clear();
  (Array.isArray(network.routes) ? network.routes : []).forEach(route => {
    const routeKey = normalizeRouteId(route.id);
    if (!routeKey) return;
    if (!routesByKey.has(routeKey)) routesByKey.set(routeKey, []);
    routesByKey.get(routeKey).push(route);
    lineColors[routeKey] = normalizeHexColor(route.color);
  });
  networkHasServiceSoon = hasServiceInLookahead(network);
  if (!networkHasServiceSoon) {
    console.warn('Aucun service GTFS actif trouvé, affichage de tous les tracés.');
  }
}

// Revalidé à chaque visite (réponse 304 s'il n'a pas changé) ; les fichiers qu'il
// référence portent une empreinte et restent en cache.
fetchJson(DATA_DIR + 'network.json', { cache: 'no-cache' })
.then(network => {
  applyNetworkIndex(network);

  fetchDataFile(network.stops)
    .then(stopsFile => {
      applyStopsFile(stopsFile);
      initStopsLayer();
      refreshSelectedVehicleInfo();
    })
    .catch(err => console.warn('Impossible de charger les arrêts :', err));

  // Définit les catégories et leurs lignes
  const categories = [
    { title: 'Tramway',             routes: ['A','B','C'] },
    { title: 'Lignes majeures',     routes: ['01','02','03','04'] },
    { title: 'Lignes de proximité', routes: ['05','06','07','08','09','10','11','12'] },
    { title: 'Lignes express',      routes: ['20','21','22','23','24','25'] },
    { title: 'Lignes suburbaines',  routes: Array.from({length:13}, (_,i) =>
                                        String(30 + i).padStart(2,'0')) }
  ];

  // Initialise panneau de filtres
  const filterPanel = filterPanelEl;
  const filterHeader = filterPanel ? filterPanel.querySelector('strong') : null;
  const filterList = filterListEl;

  if (filterHeader) {
    filterHeader.textContent = 'Filtrer les lignes';
  }

  if (filterList) {
    filterList.innerHTML = '';
  }
  routeCountBadges.clear();

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'toggle-all-btn';
  toggleBtn.textContent = 'Tout cocher';
  toggleBtn.addEventListener('click', () => {
    if (!filterList) return;
    const allCheckboxes = filterList.querySelectorAll('input[type="checkbox"]');
    const selectAll = toggleBtn.textContent === 'Tout cocher';
    allCheckboxes.forEach(chk => {
      chk.checked = selectAll;
      const rid = chk.value;
      if (selectAll) {
        selectedRoutes.add(rid);
      } else {
        selectedRoutes.delete(rid);
      }
    });
    toggleBtn.textContent = selectAll ? 'Tout décocher' : 'Tout cocher';
    persistSelectedRoutes();
    updateLines();
    updateVehicles();
  });

  if (filterList) {
    filterList.appendChild(toggleBtn);

    categories.forEach(cat => {
      const catTitle = document.createElement('div');
      catTitle.textContent = cat.title;
      catTitle.style.fontWeight = 'bold';
      catTitle.style.margin = '8px 0 4px';
      filterList.appendChild(catTitle);

      cat.routes.forEach(routeId => {
        const routeKey = normalizeRouteId(routeId);
        if (!routeKey || !(routeKey in lineColors)) return;

        const palette = computeBadgePalette(lineColors[routeKey]);

        const wrapper = document.createElement('div');
        wrapper.classList.add('checkbox-wrapper');
        wrapper.style.setProperty('--line-color', palette.base);

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.id = 'chk-' + routeKey;
        chk.value = routeKey;
        chk.checked = selectedRoutes.has(routeKey);

        const lbl = document.createElement('label');
        lbl.htmlFor = chk.id;
        lbl.style.setProperty('--line-color', palette.base);

        const labelText = document.createElement('span');
        labelText.className = 'filter-line-label-text';
        labelText.textContent = formatRouteLabel(routeKey);
        labelText.style.color = palette.base;

        const countBadge = document.createElement('span');
        countBadge.className = 'filter-line-count';
        countBadge.textContent = '0';
        applyCountBadgePalette(countBadge, palette);
        routeCountBadges.set(routeKey, countBadge);

        lbl.append(labelText, countBadge);

        chk.addEventListener('change', () => {
          const key = chk.value;
          if (chk.checked) {
            selectedRoutes.add(key);
          } else {
            selectedRoutes.delete(key);
          }
          persistSelectedRoutes();
          updateLines();
          updateVehicles();
        });

        wrapper.append(chk, lbl);
        filterList.appendChild(wrapper);
      });
    });

    const allCheckboxes = filterList.querySelectorAll('input[type="checkbox"]');
    const allSelected = allCheckboxes.length > 0 && Array.from(allCheckboxes).every(chk => chk.checked);
    toggleBtn.textContent = allSelected ? 'Tout décocher' : 'Tout cocher';
  }

  updateFilterVehicleCounts(latestVehicleCounts);

  // Initial render
  const linesReady = updateLines();
  if (hasTargetMapCenter) {
    map.setView([targetMapLat, targetMapLon], Number.isFinite(targetMapZoom) ? targetMapZoom : 17);
    L.circleMarker([targetMapLat, targetMapLon], {
      radius: 7,
      fillColor: '#d61f2c',
      color: '#ffffff',
      weight: 3,
      fillOpacity: 1
    }).addTo(map);
  }
  Promise.all([linesReady, updateVehicles()]).finally(() => hideLoadingOverlay());
  setInterval(updateVehicles, UPDATE_INTERVAL_MS);
})
.catch(err => {
  console.error('Échec chargement initial :', err);
  showLoadingOverlayError('Impossible de charger les données. Veuillez réessayer plus tard.');
});


// ==================================
// 7. BOUTON "ME LOCALISER"
// ==================================
const locateBtn = document.getElementById("locate_btn");
locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('La géolocalisation n’est pas prise en charge par votre navigateur.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    position => {
      const { latitude, longitude } = position.coords;
      // Centre la carte sur la position de l’utilisateur (zoom 16)
      map.setView([latitude, longitude], 16);
      if(locateMarker) map.removeLayer(locateMarker); // Supprime l'ancien marqueur

      // Marqueur temporaire "Vous êtes ici"
      locateMarker = L.marker([latitude, longitude])
        .addTo(map)
        .bindPopup('Vous êtes ici')
        .openPopup();
    },
    error => {
      console.error('Erreur lors de la récupération de la position :', error);
      alert('Impossible de récupérer votre position.');
    },
    {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0
    }
  );
});


// ==================================
// 8. LAYER GROUP ARRÊTS + ZOOM-TOGGLE
// ==================================
let stopsLayer;
function initStopsLayer() {
  stopsLayer = L.layerGroup();
  const ZOOM_THRESHOLD = 16;
  stopsData.forEach(s => {
    if (s.stop_coordinates?.lat && s.stop_coordinates?.lon) {
      const cm = L.circleMarker(
        [s.stop_coordinates.lat, s.stop_coordinates.lon],
        {
          radius: 4,
          fillColor: '#fff',
          color: '#483f91',
          weight: 2,
          fillOpacity: 1
        }
      ).bindTooltip(s.stop_name, { direction:'right', offset:[6,0] });
      stopsLayer.addLayer(cm);
    }
  });
  function toggleStops() {
    map.getZoom() >= ZOOM_THRESHOLD
      ? map.addLayer(stopsLayer)
      : map.removeLayer(stopsLayer);
  }
  toggleStops();
  map.on('zoomend', toggleStops);
}


// ==================================
// 9. AFFICHAGE DES VÉHICULES
// ==================================
const UPDATE_INTERVAL_MS = 30000;
const timerEl = document.getElementById('update_timer');
let remainingTime = UPDATE_INTERVAL_MS / 1000;
function updateTimerDisplay() {
  timerEl.textContent = `Mise à jour dans ${remainingTime}s`;
}
updateTimerDisplay();
setInterval(() => {
  if (remainingTime > 0) {
    remainingTime--;
    updateTimerDisplay();
  }
}, 1000);

const VEHICLES_URL = 'https://web-production-c4b0.up.railway.app/irigo.json';
//const VEHICLES_URL = 'http://localhost:5000/irigo.json';

function fetchVehiclesPayload() {
  return fetchJson(VEHICLES_URL);
}

// Première requête lancée dès maintenant, en parallèle du chargement des données de la carte.
let pendingVehiclesPayload = fetchVehiclesPayload();
pendingVehiclesPayload.catch(() => {}); // erreur traitée dans chargerVehicules

let markers = [];
async function chargerVehicules() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  let trackedMarker = null;
  let selectedVehicleStillVisible = false;
  try {
    const request = pendingVehiclesPayload || fetchVehiclesPayload();
    pendingVehiclesPayload = null;
    const payload = await request;
    const data = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.vehicles)
        ? payload.vehicles
        : [];
    const noVehiclesBanner = document.getElementById('no-vehicles-banner');
    if (noVehiclesBanner) {
      noVehiclesBanner.classList.toggle('is-hidden', data.length > 0);
    }
    const routeCounts = new Map();
    data.forEach(v => {
      const routeKey = normalizeRouteId(v.route_id);
      if (!routeKey) return;
      routeCounts.set(routeKey, (routeCounts.get(routeKey) || 0) + 1);
    });
    updateFilterVehicleCounts(routeCounts);

    data.forEach(v => {
      const routeKey = normalizeRouteId(v.route_id);
      if (!routeKey || !selectedRoutes.has(routeKey)) return;

      const lineColorHex = normalizeHexColor(lineColors[routeKey]);
      const sanitizedColor = lineColorHex.slice(1);
      const icon = ['A','B','C'].includes(routeKey)
        ? getTramIcon(sanitizedColor)
        : getBusIcon(sanitizedColor);

      let busLabel = v.id;
      if (busLabel && busLabel.length > 4) busLabel = 'Bus Suburbain';

      const vehicleContext = { vehicle: v, routeKey, busLabel };

      const followLabel = trackedBusId === v.id
        ? 'Arrêter le suivi'
        : 'Suivre ce véhicule';
      const popupHtml = `
        <div class="vehicle-popup">
          <button class="follow-btn" data-id="${v.id}">${followLabel}</button>
        </div>
      `.trim();

      const m = L.marker([v.latitude, v.longitude], { icon })
        .addTo(map)
        .bindPopup(popupHtml);

      m.on('popupopen', e => {
        showVehicleInfo(vehicleContext, true);
        const btn = e.popup.getElement().querySelector('.follow-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
          if (trackedBusId === v.id) {
            trackedBusId = null;
            trackedPopupOpen = false;
            trackedBusLabel = null;
            btn.textContent = 'Suivre ce véhicule';
            updateTrackHint();
          } else {
            trackedBusId = v.id;
            trackedPopupOpen = true;
            trackedBusLabel = busLabel;
            btn.textContent = 'Arrêter le suivi';
            updateTrackHint();
            map.setView(m.getLatLng(), map.getZoom());
          }
        });
      });

      if (selectedVehicleId === v.id) {
        selectedVehicleStillVisible = true;
        showVehicleInfo(vehicleContext, false);
      }

      markers.push(m);
      if (trackedBusId === v.id) {
        trackedMarker = m;
      }
    });

    if (selectedVehicleId && !selectedVehicleStillVisible) {
      clearVehicleInfoPanel();
    }

    if (trackedMarker) {
      trackedMarker.openPopup();
      map.setView(trackedMarker.getLatLng(), map.getZoom());
    } else if (trackedBusId) {
      trackedBusId = null;
      trackedBusLabel = null;
      trackedPopupOpen = false;
      updateTrackHint();
    }
  } catch (e) {
    console.warn('Impossible de charger les véhicules :', e);
    const noVehiclesBanner = document.getElementById('no-vehicles-banner');
    if (noVehiclesBanner) {
      noVehiclesBanner.classList.remove('is-hidden');
    }
  }
}



async function updateVehicles() {
  remainingTime = UPDATE_INTERVAL_MS / 1000;
  updateTimerDisplay();
  await chargerVehicules();
}
