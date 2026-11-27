// NOAA CPC weekly OISSTv2.1, anomalies relative to the 1991–2020 climatology.
export const temperatureSourceUrl = 'https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for';
const day = 86400000;
const firstWeek = Date.UTC(1981, 8, 2);
const monthCodes = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
const headings = [
  'Weekly SST data starts week centered on 2Sept1981',
  'Nino1+2 Nino3 Nino34 Nino4',
  'Week SST SSTA SST SSTA SST SSTA SST SSTA',
];
// The fixed-width CPC file joins a negative anomaly directly to its SST.
const pair = '(\\d{2}\\.\\d)(\\s+[+-]?\\d{1,2}\\.\\d|-\\d{1,2}\\.\\d)';
const weekRow = new RegExp('^(\\d{2}[A-Z]{3}\\d{4})\\s+' + Array(4).fill(pair).join('\\s+') + '$');

function maximum(readings) {
  const anomaly = readings.reduce((peak, r) => Math.max(peak, r.anomaly), -Infinity);
  const tied = readings.filter((r) => r.anomaly === anomaly);
  return { ...tied.at(-1), dates: tied.map((r) => r.date) };
}

// These are comparison windows. The 2017 window follows ENFEN's technical
// report (December 2016–May 2017). 2026 is a calendar-year observation.
const periods = [
  ['1982–83','1982-01-01','1983-12-31'],
  ['1997–98','1997-01-01','1998-12-31'],
  ['2017','2016-12-01','2017-05-31'],
  ['2026','2026-01-01','2026-12-31'],
];
const isoDay = t=>new Date(t).toISOString().slice(0,10);
const weekTime = (date,direction) => firstWeek + direction((Date.parse(date)-firstWeek)/(7*day))*7*day;

function comparison(readings) {
  const rows=[];
  for (const [label,start,end] of periods) {
    const weeks=readings.filter(r=>r.date>=start && r.date<=end);
    if (!weeks.length) continue;
    rows.push({label,start,end,firstWeek:weeks[0].date,lastWeek:weeks.at(-1).date,
      peak:maximum(weeks),anomalies:weeks.map(r=>r.anomaly)});
  }
  return rows;
}

export function comparisonValid(report) {
  if (!Array.isArray(report?.comparison) || !report.seriesEnd) return false;
  const expected = periods.filter(([,start])=>weekTime(start,Math.ceil)<=Date.parse(report.seriesEnd));
  return expected.length===report.comparison.length && expected.every(([label,start,end],i)=>{
    const row=report.comparison[i];
    const first=weekTime(start,Math.ceil);
    const last=weekTime(end<report.seriesEnd?end:report.seriesEnd,Math.floor);
    if (row?.label!==label || row.start!==start || row.end!==end ||
        row.firstWeek!==isoDay(first) || row.lastWeek!==isoDay(last) ||
        !Array.isArray(row.anomalies) || row.anomalies.length!==1+(last-first)/(7*day) ||
        !row.anomalies.every(v=>Number.isFinite(v) && Math.abs(v)<=20)) return false;
    const max=Math.max(...row.anomalies), dates=[];
    row.anomalies.forEach((v,j)=>{if(v===max) dates.push(isoDay(first+j*7*day));});
    return row.peak?.anomaly===max && row.peak.date===dates.at(-1) &&
      Number.isFinite(row.peak.sst) && row.peak.sst>=10 && row.peak.sst<=40 &&
      JSON.stringify(row.peak.dates)===JSON.stringify(dates) &&
      (row.lastWeek!==report.seriesEnd || row.anomalies.at(-1)===report.latest?.anomaly) &&
      max<=report.record?.anomaly;
  });
}

export function isTemperatureSnapshot(report) {
  if (
    report?.schemaVersion !== 1 ||
    report.sourceUrl !== temperatureSourceUrl ||
    report.region !== 'Niño 1+2' ||
    report.baseline !== '1991–2020' ||
    report.product !== 'OISSTv2.1' ||
    report.seriesStart !== '1981-09-02' ||
    !Number.isFinite(Date.parse(report.checkedAt)) ||
    !Number.isInteger(report.weeks) ||
    typeof report.seriesEnd !== 'string'
  )
    return false;
  const lastTime = Date.parse(report.seriesEnd + 'T00:00:00Z');
  if (lastTime !== firstWeek + (report.weeks - 1) * 7 * day || lastTime > Date.parse(report.checkedAt))
    return false;
  const { latest, record, previousYearsRecord: prior } = report;
  for (const r of [latest, record, prior]) {
    if (
      !r ||
      !Number.isFinite(r.sst) ||
      r.sst < 10 ||
      r.sst > 40 ||
      !Number.isFinite(r.anomaly) ||
      Math.abs(r.anomaly) > 20 ||
      typeof r.date !== 'string' ||
      r.date < report.seriesStart ||
      r.date > report.seriesEnd
    )
      return false;
  }
  return (
    (report.comparison===undefined || comparisonValid(report)) &&
    latest.date === report.seriesEnd &&
    record.anomaly >= Math.max(latest.anomaly, prior.anomaly) &&
    prior.date.slice(0, 4) < latest.date.slice(0, 4) &&
    [record, prior].every((r) => Array.isArray(r.dates) && r.dates.at(-1) === r.date)
  );
}

export function parseTemperatureSeries(text, now = Date.now()) {
  const stamp = new Date(now).getTime();
  if (!Number.isFinite(stamp) || typeof text !== 'string' || text.length > 600000)
    throw new Error('Fecha o respuesta semanal de NOAA inválida');
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!headings.every((h, i) => lines[i]?.trim().replace(/\s+/g, ' ') === h))
    throw new Error('Cambió la cabecera de la serie semanal de NOAA');

  const readings = [];
  let expected = firstWeek;
  for (const line of lines.slice(headings.length)) {
    const values = weekRow.exec(line.trim());
    const date = new Date(expected);
    const code =
      String(date.getUTCDate()).padStart(2, '0') + monthCodes[date.getUTCMonth()] + date.getUTCFullYear();
    if (!values || values[1] !== code)
      throw new Error('Fila inválida o discontinuidad en la serie semanal de NOAA');
    for (let p = 2; p < values.length; p += 2) {
      const sst = Number(values[p]),
        anomaly = Number(values[p + 1]);
      if (sst < 10 || sst > 40 || Math.abs(anomaly) > 20)
        throw new Error('Temperatura NOAA fuera del intervalo físico esperado');
    }
    readings.push({
      date: date.toISOString().slice(0, 10),
      sst: Number(values[2]),
      anomaly: Number(values[3]),
    });
    expected += 7 * day;
  }
  const lastTime = expected - 7 * day;
  if (!readings.length || lastTime > stamp || stamp - lastTime > 14 * day)
    throw new Error('El último registro de NOAA es futuro o tiene más de dos semanas');
  const latest = readings.at(-1);
  const prior = readings.filter((r) => r.date.slice(0, 4) < latest.date.slice(0, 4));
  if (!prior.length) throw new Error('La serie no cubre años anteriores');
  return {
    schemaVersion: 1,
    region: 'Niño 1+2',
    baseline: '1991–2020',
    product: 'OISSTv2.1',
    units: '°C',
    seriesStart: readings[0].date,
    seriesEnd: latest.date,
    weeks: readings.length,
    checkedAt: new Date(stamp).toISOString(),
    sourceUrl: temperatureSourceUrl,
    latest,
    record: maximum(readings),
    previousYearsRecord: maximum(prior),
    comparison: comparison(readings),
  };
}

export async function fetchTemperature({ now = Date.now(), fetchImpl = fetch } = {}) {
  const response = await fetchImpl(temperatureSourceUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok || Number(response.headers.get('content-length')) > 600000)
    throw new Error('NOAA no entregó la serie semanal');
  return parseTemperatureSeries(await response.text(), now);
}
