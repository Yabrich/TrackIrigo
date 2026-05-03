import {
  createLineLogoElement,
  getPassagesUrl,
  loadStationIndex,
  stationMatchesQuery
} from '../transit-data.js';

const searchInput = document.getElementById('station-page-search');
const stationDirectory = document.getElementById('station-directory');
const stationCount = document.getElementById('station-page-count');

let stations = [];

function renderLineLogos(station) {
  const lines = document.createElement('div');
  lines.className = 'station-card__lines';

  station.lineIds.forEach(routeId => {
    lines.appendChild(createLineLogoElement(routeId));
  });

  return lines;
}

function renderStations(query = '') {
  if (!stationDirectory) return;

  const filteredStations = stations.filter(station => stationMatchesQuery(station, query));
  stationDirectory.innerHTML = '';
  stationCount.textContent = `${filteredStations.length} arrêt${filteredStations.length > 1 ? 's' : ''}`;

  if (!filteredStations.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'station-directory__empty';
    emptyState.textContent = 'Aucun arrêt ne correspond à cette recherche.';
    stationDirectory.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();
  filteredStations.forEach(station => {
    const item = document.createElement('article');
    item.className = 'station-card';
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

    const body = document.createElement('div');
    body.className = 'station-card__body';

    const title = document.createElement('h2');
    title.className = 'station-card__title';
    title.textContent = station.name;

    body.append(title, renderLineLogos(station));

    const action = document.createElement('a');
    action.className = 'station-card__action';
    action.href = getPassagesUrl(station.primaryStopId);
    action.textContent = 'Prochains passages';

    item.append(body, action);
    fragment.appendChild(item);
  });

  stationDirectory.appendChild(fragment);
}

async function initStationsPage() {
  try {
    stations = await loadStationIndex();
    renderStations(searchInput ? searchInput.value : '');
  } catch (error) {
    console.error('Impossible de charger les stations :', error);
    stationCount.textContent = 'Indisponible';
    stationDirectory.innerHTML = '';
    const emptyState = document.createElement('div');
    emptyState.className = 'station-directory__empty';
    emptyState.textContent = 'Le chargement des arrêts a échoué.';
    stationDirectory.appendChild(emptyState);
  }
}

if (searchInput) {
  searchInput.addEventListener('input', event => {
    renderStations(event.target.value);
  });
}

initStationsPage();
