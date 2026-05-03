import {
  computeUpcomingPassages,
  createLineLogoElement,
  getStationMapUrl
} from '../transit-data.js';

const stopTitle = document.getElementById('passages-stop-title');
const passagesList = document.getElementById('passages-list');
const updatedAt = document.getElementById('passages-updated');
const clock = document.getElementById('passages-clock');
const mapFrame = document.getElementById('passages-map-frame');
const stopId = new URLSearchParams(window.location.search).get('stop');

let refreshTimer = null;

function updateClock() {
  if (!clock) return;
  clock.textContent = new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderPassageTime(passage) {
  const time = document.createElement('span');
  time.className = 'passages-time';

  const minutes = document.createElement('span');
  minutes.textContent = String(passage.minutes);
  time.appendChild(minutes);

  if (passage.source === 'theoretical') {
    const marker = document.createElement('sup');
    marker.textContent = '*';
    time.appendChild(marker);
  }

  return time;
}

function renderPassages(rows) {
  passagesList.innerHTML = '';

  if (!rows.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'passages-state';
    emptyState.textContent = 'Aucun passage à afficher pour cet arrêt.';
    passagesList.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach(row => {
    const item = document.createElement('article');
    item.className = 'passages-row';

    const lineCell = document.createElement('div');
    lineCell.className = 'passages-row__line';
    lineCell.appendChild(createLineLogoElement(row.routeId, 'passages-line-logo'));

    const direction = document.createElement('div');
    direction.className = 'passages-row__direction';
    direction.textContent = row.headsign;

    const times = document.createElement('div');
    times.className = 'passages-row__times';
    row.passages.forEach(passage => {
      times.appendChild(renderPassageTime(passage));
    });

    item.append(lineCell, direction, times);
    fragment.appendChild(item);
  });

  passagesList.appendChild(fragment);
}

async function refreshPassages() {
  if (!stopId) {
    stopTitle.textContent = 'Arrêt introuvable';
    passagesList.innerHTML = '<div class="passages-state">Aucun arrêt n’a été sélectionné.</div>';
    return;
  }

  try {
    const result = await computeUpcomingPassages(stopId);
    stopTitle.textContent = result.station.name;
    document.title = `${result.station.name} - Prochains passages`;
    if (mapFrame && !mapFrame.src) {
      mapFrame.src = getStationMapUrl(result.station);
    }
    renderPassages(result.rows);
    updatedAt.textContent = `Mis à jour à ${result.generatedAt.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  } catch (error) {
    console.error('Impossible de charger les prochains passages :', error);
    stopTitle.textContent = 'Prochains passages';
    passagesList.innerHTML = '<div class="passages-state">Le chargement des prochains passages a échoué.</div>';
    updatedAt.textContent = 'Mise à jour indisponible';
  }
}

updateClock();
window.setInterval(updateClock, 10000);
refreshPassages();
refreshTimer = window.setInterval(refreshPassages, 30000);

window.addEventListener('beforeunload', () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});
