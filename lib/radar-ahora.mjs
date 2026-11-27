import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

const origin = 'https://www.senamhi.gob.pe';
const resources = origin + '/prod/sismet/v1/api/v1/public/resources';
export const radarIndex = resources + '?category=NOWCASTING_RADAR';
export const radarUrl = origin + '/?p=reportes-nowcasting-radar';
const hour = 3600000;
const retention = 24 * hour;
const months = 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ');
const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const catalog=JSON.parse(readFileSync(new URL('../public/atlas/territorios/catalogo.json',import.meta.url),'utf8'));
const byCode=new Map(catalog.departments.map(({id,name}) => [id,{region:name,ubigeo:id}]));
for (const {id,name} of catalog.provinces)
  byCode.set(id,{region:byCode.get(id.slice(0,2)).region,province:name,ubigeo:id});
for (const {id,name} of catalog.districts)
  byCode.set(id,{...byCode.get(id.slice(0,4)),district:name,ubigeo:id});

function areaIndex(rows) {
  const index=new Map();
  for (const {id,name} of rows) {
    const key=fold(name);
    if (!index.has(key)) index.set(key,[]);
    index.get(key).push(byCode.get(id));
  }
  return index;
}
const regionMap=areaIndex(catalog.departments);
const provinceMap=areaIndex(catalog.provinces);
if (provinceMap.has('nasca')) provinceMap.set('nazca',provinceMap.get('nasca'));
const districtMap=areaIndex(catalog.districts);
const cityMap=new Map(['Piura','Ica','Paita','Sullana','Talara','Sechura','Tumbes','Chiclayo'].map(name => {
  const place=provinceMap.get(fold(name))?.[0];
  return [fold(name),[{...place,locality:name}]];
}));
const namesByIndex=new Map([regionMap,provinceMap,districtMap,cityMap].map(index =>
  [index,[...index.keys()].sort((a,b) => b.length-a.length)]));
// Only exact station identities cross-checked in SENAMHI's station directory get coordinates.
const coordinateSource = origin + '/mapas/mapa-estaciones-2/';
const elChira = {region:'Piura', province:'Sullana', ubigeo:'2006', station:'El Chira', stationCode:'104109',
  coordinates:[-80.73433,-4.85519], coordinateSource};
const laArdilla = {region:'Piura', province:'Sullana', ubigeo:'2006', station:'La Ardilla', stationCode:'47E09732',
  coordinates:[-80.38819,-4.49094], coordinateSource};
const stations = new Map([elChira,laArdilla].map(s => [s.province+'|'+fold(s.station),s]));
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const iso = ms => new Date(ms).toISOString();
const normalize = s => s?.replace(/\s+/g, ' ').trim() || '';
const fileUrl = id => resources + '/' + id + '/file';

function readIndexRow(row) {
  if (row?.category !== 'NOWCASTING_RADAR' || row.type !== 'PDF' || row.file !== true ||
      !Number.isSafeInteger(row.id) || row.id < 1 || row.fileUrl !== fileUrl(row.id) ||
      !/^[A-ZÁÉÍÓÚÑ -]{2,32}$/.test(row.location || '') || !/^20\d\d-\d\d-\d\d$/.test(row.date) ||
      !timePattern.test(row.time)) return null;
  const issued = Date.parse(row.date + 'T' + row.time + ':00-05:00');
  if (!Number.isFinite(issued) || iso(issued - 5 * hour).slice(0, 10) !== row.date) return null;
  const radarName = normalize(String(row.locationName || row.location)).slice(0, 50);
  return {id:row.id, radar:row.location, radarName, issuedAt:iso(issued), url:row.fileUrl};
}

function validity(header, issuedAt) {
  const match = fold(header).match(/vigencia\s+de\s+(\d{1,2}:\d{2})\s+a\s+(\d{1,2}:\d{2})\s+horas?\s+del?\s+(.+)/);
  if (!match) return;
  const [, start, end, written] = match;
  const clock = t => t.padStart(5, '0');
  if (!timePattern.test(clock(start)) || !(timePattern.test(clock(end)) || end === '24:00')) return;
  const localDay = value => iso(value - 5*hour).slice(0,10);
  const date = localDay(Date.parse(issuedAt));
  const from = Date.parse(date + 'T' + clock(start) + ':00-05:00');
  let until = Date.parse(date + 'T' + clock(end) + ':00-05:00');
  if (until < from) until += 24 * hour;
  if (from !== Date.parse(issuedAt) || !(until > from && until <= from + 6 * hour)) return;
  const printedDate = (day,month,year) => [year,String(months.indexOf(month.replace('setiembre','septiembre'))+1).padStart(2,'0'),day.padStart(2,'0')].join('-');
  // A midnight bulletin may print both days, sharing their month and year.
  const range = written.match(/^(\d{1,2})(?: de ([a-z]+)(?: (?:del? )?(20\d\d))?)? y (\d{1,2}) de ([a-z]+) (?:del? )?(20\d\d)\b/);
  if (range) {
    const [,d1,m1,y1,d2,m2,y2]=range;
    if (localDay(until)===date || printedDate(d1,m1||m2,y1||date.slice(0,4))!==date ||
        printedDate(d2,m2,y2)!==localDay(until)) return;
  } else {
    const single=written.match(/^(\d{1,2}) de ([a-z]+) (?:del? )?(20\d\d)\b(?!\s+y\s+\d)/);
    if (!single || printedDate(...single.slice(1))!==date) return;
  }
  return {validFrom:iso(from), validUntil:iso(until)};
}

const forecastCue = /(?:\b(?:para|en|durante)\s+(?:(?:las?|la)\s+)?pr[oó]xim[ao]s?\s+horas?\b|\b(?:no\s+)?se\s+(?:prev[eé]n?|preve[eé]n?|esperan?|pronostican?|estiman?)\b|\bsin condiciones favorables\b|\bno existen condiciones favorables\b)/i;
const observationCue = /\b(?:durante|en)\s+la\s+[uú]ltima\s+hora\b/i;
const wet = /\b(?:precipitaci[oó]n(?:es)?|lluvias?|lloviznas?)\b/i;
const noRain = /\b(?:no\s+(?:se\s+|hay\b|existen\b|presenta)|sin\s+(?:lluvias?|precipitaci[oó]n|condiciones)|(?:lluvias?|precipitaciones)\s+no\s+significativ|ausencia\s+de|descarta)/i;
function sections(body) {
  let phase;
  const observed = [], predicted = [];
  for (const raw of body.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/u)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const firstObservation = sentence.search(observationCue);
    const firstForecast = sentence.search(forecastCue);
    if (firstObservation >= 0 && (firstForecast < 0 || firstObservation < firstForecast)) {
      phase = 'observation';
      if (firstForecast > firstObservation) {
        observed.push(sentence.slice(0, firstForecast).trim());
        predicted.push(sentence.slice(firstForecast));
        phase = 'forecast';
        continue;
      }
    } else if (firstForecast >= 0) {
      phase = 'forecast';
    }
    if (phase === 'observation') observed.push(sentence);
    if (phase === 'forecast') predicted.push(sentence);
  }
  return {observationText:observed.join(' '), forecastText:predicted.join(' ')};
}

function locations(sentence) {
  // A region across a border is a reference point, never an affected place solely by proximity.
  const text = fold(sentence).split(/\b(?:en el limite con|limitrofes? con|en la frontera con)\b/)[0];
  const tokens = [];
  for (const marker of text.matchAll(/\b(distritos?|provincias?|departamentos?|regiones|region|ciudades|ciudad)\s+(?:de\s+)?/g)) {
    const type = marker[1];
    const dict = type.startsWith('distrito') ? districtMap : type.startsWith('provincia') ? provinceMap : type.startsWith('ciudad') ? cityMap : regionMap;
    let tail = text.slice(marker.index + marker[0].length);
    for (;;) {
      const name = namesByIndex.get(dict).find(key => tail.startsWith(key) && !/[a-z]/.test(tail.charAt(key.length) || ' '));
      if (!name) break;
      const after=tail.slice(name.length);
      const qualifier=after.match(/^\s*(?:,\s*(?:en (?:la|el) )?(?:provincia|departamento|region) (?:de )?|\()(\p{L}+(?: \p{L}+)*)/u)?.[1] || '';
      tokens.push({choices:dict.get(name),qualifier});
      const continuation = tail.slice(name.length).match(/^\s*(?:,\s*(?:y\s+)?|\s+(?:y|e)\s+)(?:de\s+)?/);
      if (!continuation) break;
      tail = tail.slice(name.length + continuation[0].length);
    }
  }
  const places=tokens.flatMap(({choices,qualifier})=>{
    if (choices.length===1) return choices;
    const candidates=choices.filter(place => [place.region,place.province].filter(Boolean).some(name => {
      const key=fold(name);
      return qualifier===key || qualifier.startsWith(key+' ');
    }));
    return candidates.length===1 ? candidates : [];
  });
  return [...new Map(places.map(p => [JSON.stringify(p),p])).values()].filter(p =>
    p.province || !places.some(other => other.region === p.region && other.province));
}

function gauges(sentence, radar) {
  const result = [];
  let start=0, provinceList=false;
  for (const group of sentence.matchAll(/\(([^()]+)\)/g)) {
    const prefix=fold(sentence.slice(start,group.index)).trim();
    start=group.index+group[0].length;
    const explicit=prefix.match(/\b(provincias?) de ([\p{L} -]+)$/u);
    const continuation=provinceList && prefix.match(/^(?:,\s*(?:y\s+)?|y\s+)(?!en )([\p{L} -]+)$/u);
    provinceList=explicit ? explicit[1]==='provincias' : Boolean(continuation);
    // Standalone "en Tumbes" can identify the region but supplies no province.
    const standalone=prefix.match(/\ben (?:el departamento de |la region de )?([\p{L} -]+)$/u);
    const candidates=explicit ? provinceMap.get(explicit[2]) : continuation ? provinceMap.get(continuation[1]) :
      standalone && regionMap.get(standalone[1]);
    const place = candidates?.length===1 ? candidates[0] : null;
    if (!place || !/\bmm\b/i.test(group[1])) continue;
    // The common millimetre unit can be elided between two other readings in a gauge list.
    for (const m of group[1].matchAll(/(?:^|,\s*|\s+y\s+)estaci[oó]n\s+([\p{L}\d .'-]+?)\s*:\s*(\d+(?:[.,]\d+)?)(?:\s*(mm))?(?=\s*(?:$|,\s*estaci[oó]n|y\s+estaci[oó]n))/giu)) {
      const station=m[1].trim();
      const resolved=stations.get(place.province+'|'+fold(station)) || {...place,station};
      result.push({...place,...resolved,mm:Number(m[2].replace(',','.')),...(!m[3] ? {unitFromGroup:true} : {})});
    }
  }
  for (const m of sentence.matchAll(/\bciudad\s+de\s+([\p{L} -]+?)\s+con\s+(\d+(?:[.,]\d+)?)\s*mm\b/giu)) {
    const place = cityMap.get(fold(m[1]))?.[0];
    if (place) result.push({...place, mm:Number(m[2].replace(',','.'))});
  }
  const namedGauge=sentence.match(/(?:^|,\s*|\by\s+)El Chira\s+(\d+(?:[.,]\d+)?)\s*mm\b/i);
  if (radar==='PIURA' && namedGauge && !result.some(row=>row.stationCode===elChira.stationCode))
    result.push({...elChira, mm:Number(namedGauge[1].replace(',','.'))});
  return result;
}

function extractPlaces(report, field) {
  const observed = field === 'observationText';
  const from = observed ? iso(Date.parse(report.validFrom) - hour) : report.validFrom;
  const until = observed ? report.validFrom : report.validUntil;
  // A two-hour display window after the measurement is an editorial freshness limit.
  const expiresAt = observed ? iso(Date.parse(until) + 2 * hour) : until;
  const rows = [];
  for (const text of report[field].split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/u)) {
    if ((!wet.test(text) && !/\bacumulados?\b.*\bmm\b/i.test(text)) || noRain.test(text)) continue;
    const measured = observed ? gauges(text, report.radar) : [];
    const places = [...measured,...locations(text).filter(place =>
      !measured.some(m => m.province === place.province && m.region === place.region))];
    for (const p of places) rows.push({...p, text, from, until, expiresAt, issuedAt:report.issuedAt,
      reportId:report.id, url:report.url, radar:report.radar});
  }
  return rows;
}

export function parseRadarReport(row, page) {
  const headerEnd = /precipitaci[oó]n\s+estimada\s+para\s+la\s+(?:2da|2a|segunda)\s+hora[^\n\f]*/i.exec(page);
  const info = readIndexRow(row);
  if (!headerEnd || !info) throw Error('Formato de reporte de radar sin reconocer');
  const times = validity(normalize(page.slice(0, headerEnd.index)), info.issuedAt);
  const body = normalize(page.slice(headerEnd.index + headerEnd[0].length).split('\f')[0]);
  if (!times || !body || body.length > 6500) throw Error('Vigencia o texto del radar sin verificar');
  const parts = sections(body);
  if (!parts.observationText && !parts.forecastText) throw Error('Sin intervalo de observación o pronóstico identificable');
  return {...info, ...times, ...parts};
}

async function download(fetchImpl, url, pdf) {
  const response = await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(7500)});
  const mime = response.headers.get('content-type')?.toLowerCase().split(';')[0].trim();
  const limit = 4000000;
  if (!response.ok || (pdf ? mime !== 'application/pdf' : mime !== 'application/json') ||
      Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw Error('Respuesta de radar no utilizable');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit) throw Error('Respuesta de radar demasiado grande');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks, bytes);
  if (pdf && buffer.subarray(0,5).toString() !== '%PDF-') throw Error('PDF de radar no válido');
  return buffer;
}

function extractPdf(buffer) {
  return new Promise((resolve,reject) => {
    const proc = execFile('pdftotext',['-f','1','-l','1','-layout','-enc','UTF-8','-','-'],
      {timeout:5000,killSignal:'SIGKILL',maxBuffer:256000,env:{PATH:process.env.PATH,LC_ALL:'C'}},
      (error,output) => error ? reject(error) : resolve(output));
    proc.stdin.on('error',() => {});
    proc.stdin.end(buffer);
  });
}

export function materialize(reports, now, meta) {
  const at = now.valueOf();
  const recent = reports.filter(r => Date.parse(r.issuedAt) <= at && Date.parse(r.issuedAt) >= at-retention)
    .sort((a,b) => b.issuedAt.localeCompare(a.issuedAt) || b.id-a.id);
  const latest = new Map();
  for (const r of recent) if (!latest.has(r.radar)) latest.set(r.radar,r);
  const records = recent.map(report => ({...report, observations:extractPlaces(report,'observationText'),
    forecasts:extractPlaces(report,'forecastText')}));
  const current = row => Date.parse(row.from) <= at && at < Date.parse(row.expiresAt);
  const observations = records.flatMap(r => r.observations).filter(current);
  const coverage = [...new Set([...Object.keys(meta.desks),...latest.keys()])].sort().map(code => {
    const last = latest.get(code);
    const indexed = meta.desks[code];
    const latestIssuedAt = indexed?.latestIssuedAt || last?.issuedAt || null;
    const latestReportId = indexed?.latestReportId || last?.id || null;
    const read = last && last.id === latestReportId;
    return {code, name:indexed?.name || last?.radarName || code, latestIssuedAt, latestReportId,
      validUntil:read ? last.validUntil : null,
      status:!read ? 'unavailable' : Date.parse(last.validUntil) > at ? 'current' : 'stale'};
  });
  const currentIds = new Set(coverage.filter(area => area.status === 'current').map(area => area.latestReportId));
  const forecasts = records.filter(r => currentIds.has(r.id)).flatMap(r => r.forecasts).filter(current);
  const {desks,...source} = meta;
  if (source.status === 'ok' && !coverage.some(area => area.status === 'current')) source.status='stale';
  return {schemaVersion:1, sourceUrl:radarUrl, indexUrl:radarIndex, ...source, coverage, reports:records, observations, forecasts};
}

// The most recent attempt determines feed health. Each desk and issue hour
// independently determines which edition of the PDF may supply observations.
const revisionSlot = (radar, issuedAt) => radar + '/' + Date.parse(issuedAt);
const compareDesk = (a,b) => Date.parse(a.latestIssuedAt) - Date.parse(b.latestIssuedAt) || a.latestReportId - b.latestReportId;
export function mergedRadar(seed, published, now) {
  const at = +now;
  const readings = [seed, published].filter(r => r?.schemaVersion === 1 && Array.isArray(r.reports) &&
    Date.parse(r.checkedAt) > 0 && Date.parse(r.checkedAt) <= at).sort((a,b) =>
    Date.parse(a.checkedAt) - Date.parse(b.checkedAt) || (Date.parse(a.lastSuccessAt) || 0) - (Date.parse(b.lastSuccessAt) || 0));
  if (!readings.length) return null;
  const reports = new Map(), revisions = new Map(), desks = {};
  let lastSuccessAt = null;
  for (const reading of readings) {
    const success = Date.parse(reading.lastSuccessAt);
    if (success > (Date.parse(lastSuccessAt) || 0) && success <= Date.parse(reading.checkedAt))
      lastSuccessAt = reading.lastSuccessAt;
    for (const desk of reading.coverage || []) {
      const issued = Date.parse(desk.latestIssuedAt);
      if (!Number.isFinite(issued) || issued > at || !Number.isSafeInteger(desk.latestReportId)) continue;
      const slot = revisionSlot(desk.code, desk.latestIssuedAt);
      revisions.set(slot, Math.max(revisions.get(slot) || 0, desk.latestReportId));
      const old = desks[desk.code];
      if (!old || compareDesk(desk,old) >= 0) desks[desk.code] = desk;
    }
    for (const report of reading.reports) {
      const slot = revisionSlot(report.radar, report.issuedAt);
      if (!reports.has(slot) || report.id >= reports.get(slot).id) reports.set(slot, report);
    }
  }
  // A correction listed but not yet downloaded invalidates that hour's older
  // text, including after a subsequent hour has become the latest for the desk.
  const current = [...reports].filter(([slot, report]) => report.id >= (revisions.get(slot) || 0)).map(([, report]) => report);
  const newest = readings.at(-1);
  const status = newest.status === 'unavailable' && lastSuccessAt ? 'stale' : newest.status;
  return materialize(current, new Date(at), {status, checkedAt:newest.checkedAt, lastSuccessAt, desks});
}

export async function refreshRadar(previous = null, {now = new Date(), fetchImpl = fetch, extract = extractPdf, force = false} = {}) {
  const at = now.valueOf();
  const cached = previous?.schemaVersion === 1 && Array.isArray(previous.reports) ? previous.reports : [];
  const oldMeta = {status:previous?.status || 'unavailable', checkedAt:previous?.checkedAt || null,
    lastSuccessAt:previous?.lastSuccessAt || null, desks:Object.fromEntries((previous?.coverage || []).map(area => [area.code,area]))};
  if (!force && oldMeta.checkedAt && at >= Date.parse(oldMeta.checkedAt) && at-Date.parse(oldMeta.checkedAt) < 5 * 60000)
    return materialize(cached,now,oldMeta);
  const checkedAt = now.toISOString();
  try {
    const body = JSON.parse(await download(fetchImpl,radarIndex,false));
    if (body.status !== true || !Array.isArray(body.data)) throw Error('Índice de radar inválido');
    const groups = new Map();
    for (const row of body.data) {
      const info = readIndexRow(row);
      if (!info) continue;
      const issued = Date.parse(info.issuedAt);
      if (issued > at || issued < at-retention) continue;
      if (!groups.has(info.radar)) groups.set(info.radar,new Map());
      const bucket = groups.get(info.radar);
      if (!bucket.has(info.issuedAt) || bucket.get(info.issuedAt).id < row.id) bucket.set(info.issuedAt,row);
    }
    if (!groups.size) return materialize(cached,now,{...oldMeta,status:'stale',checkedAt});
    // First recover the latest issue of each desk, then backfill earlier slots, at most six PDFs per pass.
    const buckets = [...groups.values()].map(group => [...group.values()].sort((a,b) =>
      b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.id-a.id));
    const byId = new Map(cached.map(r => [r.id,r]));
    const revisions = new Map(cached.map(r => [revisionSlot(r.radar,r.issuedAt),r.id]));
    for (const desk of Object.values(oldMeta.desks)) {
      const slot = revisionSlot(desk.code,desk.latestIssuedAt);
      revisions.set(slot,Math.max(revisions.get(slot) || 0,desk.latestReportId || 0));
    }
    const desks = {...oldMeta.desks};
    let indexBehind = false;
    for (const group of buckets) {
      const head = readIndexRow(group[0]);
      const desk = {name:head.radarName,latestIssuedAt:head.issuedAt,latestReportId:head.id};
      if (desks[head.radar] && compareDesk(desk,desks[head.radar]) < 0) indexBehind = true;
      else desks[head.radar] = desk;
    }
    const missing = [];
    const depth = Math.max(...buckets.map(group => group.length));
    for (let i=0; i<depth && missing.length<6; i++) {
      for (const group of buckets) {
        const row = group[i];
        if (!row || byId.has(row.id) || missing.length>=6) continue;
        const info = readIndexRow(row);
        if (row.id >= (revisions.get(revisionSlot(info.radar,info.issuedAt)) || 0)) missing.push(row);
      }
    }
    const fetched = await Promise.allSettled(missing.map(async row =>
      parseRadarReport(row, await extract(await download(fetchImpl,row.fileUrl,true)))));
    for (const result of fetched) if (result.status === 'fulfilled') byId.set(result.value.id,result.value);
    // A corrected issue supersedes earlier text for exactly the same desk and time.
    const superseded = new Set(cached.filter(r => groups.get(r.radar)?.get(r.issuedAt)?.id > r.id).map(r => r.id));
    const reports = [...byId.values()].filter(r => !superseded.has(r.id));
    const complete = !indexBehind && buckets.every(group => byId.has(group[0].id));
    const available = buckets.some(group => byId.has(group[0].id));
    const status = complete ? (buckets.some(group => Date.parse(byId.get(group[0].id).validUntil) > at) ? 'ok' : 'stale') :
      (available || reports.length ? 'partial' : 'unavailable');
    return materialize(reports,now,{status,checkedAt,lastSuccessAt:complete ? checkedAt : oldMeta.lastSuccessAt,desks});
  } catch {
    return materialize(cached,now,{...oldMeta,status:cached.length ? 'stale' : 'unavailable',checkedAt});
  }
}
