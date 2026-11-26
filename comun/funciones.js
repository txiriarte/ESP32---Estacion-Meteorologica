
const IAQ_LEVELS = [
  { max: 50, label: 'Excelente', color: '#34d399', background: '#064e3b' },
  { max: 100, label: 'Bueno', color: '#a3e635', background: '#365314' },
  { max: 150, label: 'Lig. contaminado', color: '#facc15', background: '#713f12' },
  { max: 200, label: 'Mod. contaminado', color: '#fb923c', background: '#7c2d12' },
  { max: 250, label: 'Muy contaminado', color: '#f87171', background: '#7f1d1d' },
  { max: 350, label: 'Severo', color: '#e879f9', background: '#701a75' },
  { max: Infinity, label: 'Extremo', color: '#d97706', background: '#451a03' },
];

export function getIaqLevel(value) {
  if (!Number.isFinite(value)) {
    return { label: 'Analizando', color: '#94a3b8', background: '#1e293b' };
  }

  return IAQ_LEVELS.find((level) => value <= level.max);
}

export function formatFixed(value, decimals = 1, fallback = '--') {
  return Number.isFinite(value) ? value.toFixed(decimals) : fallback;
}

export function formatRounded(value, fallback = '--') {
  return Number.isFinite(value) ? String(Math.round(value)) : fallback;
}

// export function findLatestWeather(records) {
//   return [...records]
//     .reverse()
//     .find((record) => record.clima_exterior?.temperatura !== undefined)
//     ?.clima_exterior ?? null;
// }



