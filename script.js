import {
  createLineLogoElement,
  getPassagesUrl,
  loadStationIndex,
  stationMatchesQuery
} from './transit-data.js';

function parseCSV(text) {
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

const lineCategories = [
  { title: 'Tramway', lines: ['A', 'B', 'C'] },
  { title: 'Lignes majeures', lines: ['1', '2', '3', '4'] },
  { title: 'Lignes de proximité', lines: ['5', '6', '7', '8', '9', '10', '11', '12'] },
  { title: 'Lignes express', lines: ['E20', 'E21', 'E22', 'E23', 'E24', 'E25'] },
  { title: 'Lignes suburbaines', lines: ['30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42'] }
];
const lineColorByRouteKey = {
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

const stationSearchInput = document.getElementById('station-search');
const stationResults = document.getElementById('station-results');
const stationCount = document.getElementById('station-count');
const lineCategoriesContainer = document.getElementById('line-categories');
const carouselTrack = document.getElementById('carousel-track');

let stationIndex = [];
const lineTrafficState = new Map();
let carouselImages = [];
let carouselIndex = 0;
let carouselIntervalId = null;

function normalizeRouteId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const expressMatch = raw.match(/^E(\d{1,2})$/i);
  if (expressMatch) return expressMatch[1].padStart(2, '0');
  if (/^[0-9]{1,2}$/.test(raw)) return raw.padStart(2, '0');
  return raw.toUpperCase();
}

function getTrafficPriority(type) {
  switch (type) {
    case 'no-service':
      return 3;
    case 'detour':
      return 2;
    case 'warning':
      return 1;
    default:
      return 0;
  }
}

function getTrafficType(alert) {
  const effect = String(alert.effect || '').trim().toUpperCase();
  if (effect === 'NO_SERVICE') return 'no-service';
  if (effect === 'DETOUR') return 'detour';
  return 'warning';
}

function isAlertActive(alert, nowSeconds) {
  const periods = Array.isArray(alert.active_periods) ? alert.active_periods : [];
  if (!periods.length) return true;

  return periods.some(period => {
    const start = Number(period.start);
    const end = Number(period.end);
    const afterStart = !Number.isFinite(start) || start <= nowSeconds;
    const beforeEnd = !Number.isFinite(end) || nowSeconds <= end;
    return afterStart && beforeEnd;
  });
}

function isAlertRelevant(alert, nowSeconds) {
  const periods = Array.isArray(alert.active_periods) ? alert.active_periods : [];
  if (!periods.length) return true;

  return periods.some(period => {
    const end = Number(period.end);
    return !Number.isFinite(end) || end >= nowSeconds;
  });
}

function buildTrafficState(alerts) {
  lineTrafficState.clear();
  const nowSeconds = Math.floor(Date.now() / 1000);

  alerts.forEach(alert => {
    if (!alert || !isAlertRelevant(alert, nowSeconds)) return;

    const trafficType = getTrafficType(alert);
    const lineIds = Array.isArray(alert.informed_entities) ? alert.informed_entities : [];
    const isActive = isAlertActive(alert, nowSeconds);

    lineIds.forEach(lineId => {
      const routeKey = normalizeRouteId(lineId);
      if (!routeKey) return;

      const currentState = lineTrafficState.get(routeKey);
      const nextState = {
        type: trafficType,
        title: Array.isArray(alert.header) && alert.header.length ? String(alert.header[0]) : 'Info trafic',
        isActive: isActive
      };

      let shouldUpdate = false;
      if (!currentState) {
        shouldUpdate = true;
      } else {
        if (nextState.isActive && !currentState.isActive) {
          shouldUpdate = true;
        } else if (nextState.isActive === currentState.isActive) {
          if (getTrafficPriority(trafficType) > getTrafficPriority(currentState.type)) {
            shouldUpdate = true;
          }
        }
      }

      if (shouldUpdate) {
        lineTrafficState.set(routeKey, nextState);
      }
    });
  });
}

function getTrafficBadgeSvg(type) {
  if (type === 'no-service') {
    return '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#d61f2c"/><path d="M6 6l8 8M14 6l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>';
  }
  if (type === 'detour') {
    return '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l8.5 15H1.5L10 1.5z" fill="#ffcf33" stroke="#8a5f00" stroke-width="1.2"/><rect x="9" y="6" width="2" height="5.5" fill="#563700"/><rect x="9" y="13" width="2" height="2" fill="#563700"/></svg>';
  }
  return '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l8.5 15H1.5L10 1.5z" fill="#ffcf33" stroke="#8a5f00" stroke-width="1.2"/><rect x="9" y="6" width="2" height="5.5" fill="#563700"/><rect x="9" y="13" width="2" height="2" fill="#563700"/></svg>';
}

function applyTrafficStateToLineButtons() {
  if (!lineCategoriesContainer) return;

  const buttons = lineCategoriesContainer.querySelectorAll('.line-button');
  buttons.forEach(button => {
    const routeKey = button.dataset.routeKey || '';
    const traffic = lineTrafficState.get(routeKey);

    button.classList.remove('line-button--traffic-warning', 'line-button--traffic-detour', 'line-button--traffic-no-service');
    button.removeAttribute('data-traffic-active');
    const existingBadge = button.querySelector('.line-button__badge');
    if (existingBadge) {
      existingBadge.remove();
    }

    if (!traffic) return;

    button.setAttribute('data-traffic-active', 'true');
    button.title = `Ligne ${button.dataset.line} - ${traffic.title}${traffic.isActive ? '' : ' (à venir)'}`;

    if (traffic.type === 'no-service') {
      button.classList.add('line-button--traffic-no-service');
    } else if (traffic.type === 'detour') {
      button.classList.add('line-button--traffic-detour');
    } else {
      button.classList.add('line-button--traffic-warning');
    }

    const badge = document.createElement('span');
    badge.className = 'line-button__badge';
    if (traffic.isActive) {
      badge.classList.add('is-active');
    }
    badge.innerHTML = getTrafficBadgeSvg(traffic.type);
    button.appendChild(badge);
  });
}

function stopCarouselAutoplay() {
  if (!carouselIntervalId) return;
  window.clearInterval(carouselIntervalId);
  carouselIntervalId = null;
}

function updateCarousel() {
  if (!carouselTrack) return;
  carouselTrack.style.transform = `translateX(-${carouselIndex * 100}%)`;
}

function goToCarouselSlide(index) {
  if (!carouselImages.length) return;
  carouselIndex = (index + carouselImages.length) % carouselImages.length;
  updateCarousel();
}

function startCarouselAutoplay() {
  stopCarouselAutoplay();
  if (carouselImages.length <= 1) return;
  carouselIntervalId = window.setInterval(() => {
    goToCarouselSlide(carouselIndex + 1);
  }, 5000);
}

function renderCarousel(images) {
  if (!carouselTrack) return;

  carouselImages = images;
  carouselIndex = 0;
  carouselTrack.innerHTML = '';

  if (!images.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'carousel__empty';
    emptyState.textContent = 'Aucune photo disponible pour le moment.';
    carouselTrack.appendChild(emptyState);
    stopCarouselAutoplay();
    return;
  }

  images.forEach((imagePath, index) => {
    const slide = document.createElement('figure');
    slide.className = 'carousel__slide';

    const image = document.createElement('img');
    image.src = imagePath;
    image.alt = `Photo du reseau ${index + 1}`;
    image.loading = index === 0 ? 'eager' : 'lazy';

    slide.appendChild(image);
    carouselTrack.appendChild(slide);
  });

  updateCarousel();
  startCarouselAutoplay();
}

function normalizeCarouselImageList(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map(entry => String(entry || '').trim())
    .filter(entry => entry && /\.(avif|gif|jpe?g|png|webp)$/i.test(entry))
    .map(entry => entry.startsWith('img/') ? entry : `img/carousel/${entry}`);
}

async function loadCarouselFromDirectoryListing() {
  const response = await fetch('img/carousel/');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const fileNames = Array.from(doc.querySelectorAll('a'))
    .map(link => link.getAttribute('href') || '')
    .map(href => href.split('?')[0].trim())
    .filter(href => href && !href.startsWith('/') && !href.startsWith('?'))
    .filter(href => /\.(avif|gif|jpe?g|png|webp)$/i.test(href))
    .map(href => href.replace(/\/$/, ''));

  return normalizeCarouselImageList(fileNames);
}

async function loadCarouselFromManifest() {
  const response = await fetch('img/carousel/manifest.json');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  return normalizeCarouselImageList(payload);
}

async function loadCarousel() {
  if (!carouselTrack) return;

  try {
    const images = await loadCarouselFromDirectoryListing();
    if (images.length) {
      renderCarousel(images);
      return;
    }
  } catch (error) {
    console.warn('Listing du dossier carousel indisponible :', error);
  }

  try {
    const images = await loadCarouselFromManifest();
    renderCarousel(images);
  } catch (error) {
    console.error('Impossible de charger les photos du carousel :', error);
    renderCarousel([]);
  }
}

function renderLineCategories() {
  if (!lineCategoriesContainer) return;

  lineCategoriesContainer.innerHTML = '';
  lineCategories.forEach(category => {
    const section = document.createElement('section');
    section.className = 'line-category';

    const title = document.createElement('h3');
    title.className = 'line-category__title';
    title.textContent = category.title;

    const grid = document.createElement('div');
    grid.className = 'line-grid';

    category.lines.forEach(line => {
      const button = document.createElement('a');
      button.className = 'line-button';
      button.setAttribute('aria-label', `Ligne ${line}`);
      button.title = `Ligne ${line}`;
      button.href = `lines/${line}.html`;
      button.dataset.line = line;
      button.dataset.routeKey = normalizeRouteId(line);
      button.style.setProperty('--line-accent-color', lineColorByRouteKey[button.dataset.routeKey] || 'var(--color-red)');

      const image = document.createElement('img');
      image.src = `img/lignes/${line}.svg`;
      image.alt = `Ligne ${line}`;

      button.appendChild(image);
      grid.appendChild(button);
    });

    section.append(title, grid);
    lineCategoriesContainer.appendChild(section);
  });

  applyTrafficStateToLineButtons();
}

function renderStationResultsV2(query = '') {
  if (!stationResults) return;

  const normalizedQuery = query.trim();
  const filteredStations = normalizedQuery
    ? stationIndex.filter(station => stationMatchesQuery(station, normalizedQuery))
    : [];
  const visibleStations = filteredStations.slice(0, 12);
  stationResults.innerHTML = '';

  if (!visibleStations.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'station-result--empty';
    emptyState.textContent = normalizedQuery
      ? 'Aucun arrêt trouvé pour cette recherche.'
      : 'Utilisez la recherche ou ouvrez la liste complète des stations.';
    stationResults.appendChild(emptyState);
    return;
  }

  visibleStations.forEach(station => {
    const item = document.createElement('article');
    item.className = 'station-result';
    item.tabIndex = 0;
    item.role = 'link';
    item.setAttribute('aria-label', `Prochains passages - ${station.name}`);
    item.addEventListener('click', event => {
      if (event.target.closest('a')) return;
      window.location.href = getPassagesUrl(station.primaryStopId);
    });
    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      window.location.href = getPassagesUrl(station.primaryStopId);
    });

    const info = document.createElement('div');
    info.className = 'station-result__info';

    const name = document.createElement('div');
    name.className = 'station-result__name';
    name.textContent = station.name;

    const lines = document.createElement('div');
    lines.className = 'station-result__lines';
    station.lineIds.slice(0, 10).forEach(routeId => {
      lines.appendChild(createLineLogoElement(routeId));
    });

    if (station.lineIds.length > 10) {
      const extra = document.createElement('span');
      extra.className = 'line-logo line-logo--extra';
      extra.textContent = `+${station.lineIds.length - 10}`;
      lines.appendChild(extra);
    }

    const status = document.createElement('a');
    status.className = 'station-result__status';
    status.href = getPassagesUrl(station.primaryStopId);
    status.textContent = 'Prochains passages';

    info.append(name, lines);
    item.append(info, status);
    stationResults.appendChild(item);
  });
}

async function loadStationsV2() {
  if (!stationResults || !stationCount) return;

  try {
    stationIndex = await loadStationIndex();
    stationCount.textContent = `${stationIndex.length} arrêts`;
    renderStationResultsV2();
  } catch (error) {
    console.error('Impossible de charger les arrêts :', error);
    stationCount.textContent = 'Indisponible';
    stationResults.innerHTML = '';
    const emptyState = document.createElement('div');
    emptyState.className = 'station-result--empty';
    emptyState.textContent = 'Le chargement des arrêts a échoué.';
    stationResults.appendChild(emptyState);
  }
}

async function loadTrafficInfo() {
  try {
    const response = await fetch('https://web-production-c4b0.up.railway.app/irigo.json');
    //const response = await fetch('http://localhost:5000/irigo.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
    buildTrafficState(alerts);
    applyTrafficStateToLineButtons();
  } catch (error) {
    console.warn('Impossible de charger les infos trafic :', error);
  }
}

loadCarousel();
renderLineCategories();
loadStationsV2();
loadTrafficInfo();

if (stationSearchInput) {
  stationSearchInput.addEventListener('input', event => {
    renderStationResultsV2(event.target.value);
  });
}
