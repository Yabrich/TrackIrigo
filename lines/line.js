const lineConfig = window.TRACK_IRIGO_LINE_PAGE || {};
const lineId = String(lineConfig.lineId || '').trim();

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

const effectPresentation = {
  NO_SERVICE: { label: 'Interruption', chipClass: 'traffic-effect-tag--danger', emoji: '❌', trafficType: 'no-service' },
  REDUCED_SERVICE: { label: 'Service réduit', chipClass: 'traffic-effect-tag--warning', emoji: '⚠️', trafficType: 'warning' },
  SIGNIFICANT_DELAYS: { label: 'Retards importants', chipClass: 'traffic-effect-tag--warning', emoji: '⚠️', trafficType: 'warning' },
  DETOUR: { label: 'Déviation', chipClass: 'traffic-effect-tag--detour', emoji: '🚧', trafficType: 'detour' },
  ADDITIONAL_SERVICE: { label: 'Service additionnel', chipClass: 'traffic-effect-tag--info', emoji: 'ℹ️', trafficType: 'warning' },
  MODIFIED_SERVICE: { label: 'Service modifié', chipClass: 'traffic-effect-tag--info', emoji: 'ℹ️', trafficType: 'warning' },
  OTHER_EFFECT: { label: 'Information', chipClass: 'traffic-effect-tag--info', emoji: '⚠️', trafficType: 'warning' },
  UNKNOWN_EFFECT: { label: 'Effet inconnu', chipClass: 'traffic-effect-tag--info', emoji: '⚠️', trafficType: 'warning' },
  STOP_MOVED: { label: 'Arrêt déplacé', chipClass: 'traffic-effect-tag--warning', emoji: '📍', trafficType: 'warning' },
  NO_EFFECT: { label: 'Sans effet', chipClass: 'traffic-effect-tag--neutral', emoji: 'ℹ️', trafficType: 'warning' },
  ACCESSIBILITY_ISSUE: { label: 'Accessibilité', chipClass: 'traffic-effect-tag--warning', emoji: '♿', trafficType: 'warning' }
};

const lineLogo = document.getElementById('line-logo');
const lineTitle = document.getElementById('line-title');
const lineLastUpdated = document.getElementById('line-last-updated');
const linePlanFigure = document.getElementById('line-plan-figure');
const linePlanImage = document.getElementById('line-plan-image');
const lineTrafficList = document.getElementById('line-traffic-list');
const trafficPanelLineLogo = document.getElementById('traffic-panel-line-logo');

function normalizeRouteId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const expressMatch = raw.match(/^E(\d{1,2})$/i);
  if (expressMatch) return expressMatch[1].padStart(2, '0');
  if (/^[0-9]{1,2}$/.test(raw)) return raw.padStart(2, '0');
  return raw.toUpperCase();
}

function getFileSlug(value) {
  const normalized = normalizeRouteId(value);
  const numeric = Number(normalized);
  if (!Number.isNaN(numeric) && numeric >= 20 && numeric <= 25) {
    return `E${normalized}`;
  }
  if (!Number.isNaN(numeric) && normalized.length === 2 && numeric < 20) {
    return String(numeric);
  }
  return normalized;
}

function getEffectPresentation(effectValue) {
  const key = String(effectValue || 'UNKNOWN_EFFECT').trim().toUpperCase();
  return effectPresentation[key] || effectPresentation.UNKNOWN_EFFECT;
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

function getPrimaryPeriod(alert) {
  const periods = Array.isArray(alert.active_periods) ? alert.active_periods.slice() : [];
  if (!periods.length) return null;
  periods.sort((left, right) => {
    const leftStart = Number(left.start) || 0;
    const rightStart = Number(right.start) || 0;
    return leftStart - rightStart;
  });
  return periods[0];
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getSortTimestamp(alert) {
  const primaryPeriod = getPrimaryPeriod(alert);
  if (!primaryPeriod) return Number.POSITIVE_INFINITY;
  const start = Number(primaryPeriod.start);
  const end = Number(primaryPeriod.end);
  if (Number.isFinite(start)) return start;
  if (Number.isFinite(end)) return end;
  return Number.POSITIVE_INFINITY;
}

function getAlertTitle(alert) {
  if (Array.isArray(alert.header) && alert.header.length) {
    return String(alert.header[0]);
  }
  return 'Information trafic';
}

function getAlertDescription(alert) {
  if (Array.isArray(alert.description) && alert.description.length) {
    return String(alert.description[0]);
  }
  return 'Aucun détail supplémentaire.';
}

function renderTrafficList(alerts) {
  if (!lineTrafficList) return;
  lineTrafficList.innerHTML = '';

  if (!alerts.length) {
    const empty = document.createElement('p');
    empty.className = 'traffic-empty';
    empty.textContent = '✅ Aucune perturbation sur la ligne.';
    lineTrafficList.appendChild(empty);
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const sortedAlerts = alerts.slice().sort((left, right) => {
    const leftActive = isAlertActive(left, nowSeconds) ? 0 : 1;
    const rightActive = isAlertActive(right, nowSeconds) ? 0 : 1;
    if (leftActive !== rightActive) return leftActive - rightActive;
    return getSortTimestamp(left) - getSortTimestamp(right);
  });

  sortedAlerts.forEach(alert => {
    const effect = getEffectPresentation(alert.effect);
    const isActive = isAlertActive(alert, nowSeconds);

    const item = document.createElement('article');
    item.className = `traffic-item traffic-item--${effect.trafficType}`;

    const effectTag = document.createElement('div');
    effectTag.className = `traffic-effect-tag ${effect.chipClass}${isActive ? ' is-active' : ''}`;
    effectTag.textContent = `${effect.emoji} ${effect.label}`;

    const heading = document.createElement('div');
    heading.className = 'traffic-item__heading';

    const title = document.createElement('h3');
    title.className = 'traffic-item__title';
    title.textContent = getAlertTitle(alert);

    heading.append(title);

    const description = document.createElement('p');
    description.className = 'traffic-item__description';
    description.textContent = getAlertDescription(alert);

    item.append(effectTag, heading, description);

    if (alert.url) {
      const link = document.createElement('a');
      link.className = 'traffic-item__link';
      link.href = String(alert.url);
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = 'Plan de déviation';
      item.appendChild(link);
    }

    lineTrafficList.appendChild(item);
  });
}

async function loadTraffic() {
  try {
    const response = await fetch('https://web-production-c4b0.up.railway.app/irigo.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
    const routeKey = normalizeRouteId(lineId);
    const filteredAlerts = alerts.filter(alert => {
      const lineIds = Array.isArray(alert.informed_entities) ? alert.informed_entities : [];
      return lineIds.some(lineEntry => normalizeRouteId(lineEntry) === routeKey);
    });

    renderTrafficList(filteredAlerts);
    if (lineLastUpdated) {
      lineLastUpdated.textContent = `Dernière mise à jour : ${formatDateTime(new Date())}`;
    }
  } catch (error) {
    console.error('Impossible de charger les informations trafic :', error);
    renderTrafficList([]);
    if (lineLastUpdated) {
      lineLastUpdated.textContent = 'Dernière mise à jour indisponible';
    }
  }
}

function applyLineIdentity() {
  const routeKey = normalizeRouteId(lineId);
  const fileSlug = getFileSlug(lineId);
  const accentColor = lineColorByRouteKey[routeKey] || '#d61f2c';
  document.documentElement.style.setProperty('--line-accent-color', accentColor);

  if (lineLogo) {
    lineLogo.src = `../img/lignes/${fileSlug}.svg`;
    lineLogo.alt = `Ligne ${fileSlug}`;
  }
  if (trafficPanelLineLogo) {
    trafficPanelLineLogo.src = `../img/lignes/${fileSlug}.svg`;
    trafficPanelLineLogo.alt = `Ligne ${fileSlug}`;
  }
  if (lineTitle) {
    lineTitle.textContent = `Ligne ${fileSlug}`;
  }
  if (linePlanImage) {
    const handlePlanLoad = () => {
      if (linePlanFigure) {
        linePlanFigure.classList.remove('is-hidden');
      }
    };
    const handlePlanError = () => {
      if (linePlanFigure) {
        linePlanFigure.classList.add('is-hidden');
      }
    };

    linePlanImage.addEventListener('load', handlePlanLoad, { once: true });
    linePlanImage.addEventListener('error', handlePlanError, { once: true });
    linePlanImage.alt = `Plan de la ligne ${fileSlug}`;
    linePlanImage.src = `../img/plan/${fileSlug}.png`;

    if (linePlanImage.complete) {
      if (linePlanImage.naturalWidth > 0) {
        handlePlanLoad();
      } else {
        handlePlanError();
      }
    }
  }
}

applyLineIdentity();
loadTraffic();
