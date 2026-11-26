import {createHash} from 'node:crypto';
import {officialSources,sourceFailureCode} from './oficiales.mjs';
import {mediaSources} from './medios.mjs';
import {detectsPersonalData} from './privacidad.mjs';

const hour = 3_600_000;
const providers = [...officialSources, ...mediaSources];
const officialIds = new Set(officialSources.map(source => source.id));
const byTime = item => item.publishedAt || item.validFrom || item.firstSeenAt || '';

export function fechaPeru(value, endOfDay = false) {
  if (!value) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(value + (endOfDay ? 'T23:59:59.999-05:00' : 'T00:00:00-05:00'));
  return Date.parse(value);
}

function localDate(value) {
  const stamp = fechaPeru(value);
  return Number.isFinite(stamp) ? new Date(stamp - 5*hour).toISOString().slice(0,10) : null;
}

// The index is authoritative about which notices are still listed. A detail
// page can fail independently while the same notice is still on that index.
function reuseDetail(record, old) {
  if (!old || !record.sourceId.startsWith('senamhi-') ||
      !record.noticeNumber || record.noticeNumber !== old.noticeNumber ||
      record.title !== old.title || record.level !== old.level ||
      !record.validFrom || !record.validUntil ||
      localDate(record.validFrom) !== localDate(old.validFrom) ||
      localDate(record.validUntil) !== localDate(old.validUntil)) return;
  if (record.datePrecision === 'day' && old.datePrecision === 'minute') {
    Object.assign(record,{validFrom:old.validFrom,validUntil:old.validUntil,datePrecision:'minute'});
    if (!record.publishedAt && old.publishedAt) record.publishedAt = old.publishedAt;
  }
  if (!record.summary && old.summary) record.summary = old.summary;
  const oldMap = old.regionOrigin?.startsWith('mapa-senamhi');
  const missingMap = oldMap && !record.regionOrigin?.startsWith('mapa-senamhi');
  const partialMap = old.regionOrigin === 'mapa-senamhi' && record.regionOrigin === 'mapa-senamhi-parcial';
  if (!old.regions?.length || !(missingMap || partialMap || !record.regions.length)) return;
  record.regions = [...new Set([...record.regions,...old.regions])];
  record.region = record.regions.join(', ');
  record.regionOrigin = old.regionOrigin ?? 'texto-senamhi';
  for (const field of ['coverageUrls','districtCounts','regionLevels'])
    if (!record[field] && old[field]) record[field] = old[field];
  record.regionCoverageRetainedAt = old.regionCoverageRetainedAt || old.lastChangedAt;
}

function prepareItem(record, source, old, date) {
  if (!record.id || !record.title || !/^https?:\/\//i.test(record.url || '')) return null;
  const kind = officialIds.has(source.id) ? 'oficial' : record.kind;
  const version = createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 16);
  return {
    ...record, sourceId: source.id, sourceName: source.name, kind, version,
    firstSeenAt: old?.firstSeenAt || date,
    lastChangedAt: old?.version === version ? old.lastChangedAt : date,
  };
}

function keepRecent(item, now) {
  if (item.sourceId === 'enfen') return true;
  const date = fechaPeru(item.validUntil, true) || fechaPeru(byTime(item));
  return !Number.isFinite(date) || date >= now - (item.kind === 'oficial' ? 7 : 3) * 24 * hour;
}

async function collect(source, previous, now, force) {
  const former = previous.sources?.find(other => other.id === source.id);
  const records = (previous.items || []).filter(item => item.sourceId === source.id);
  const {fetchItems, ...meta} = source;
  const display = {...meta, kind: officialIds.has(source.id) ? 'oficial' : source.id === 'senamhi-youtube' ? 'video' : 'prensa'};
  if (!fetchItems) return {source: {...display, status: 'external', checkedAt: null, lastSuccessAt: null}, records: []};
  const current = now.getTime();
  const lastCheck = Date.parse(former?.checkedAt ?? '');
  const waitMinutes = former?.status === 'ok' ? source.intervalMinutes : Math.min(5, source.intervalMinutes);
  if (!force && lastCheck <= current && current - lastCheck < waitMinutes * 60_000) return {source: former, records};
  const checkedAt = now.toISOString();
  const oldById = new Map(records.map(item => [item.id, item]));
  try {
    const found = await fetchItems({previousItems:records, now});
    if (!Array.isArray(found)) throw new Error('Formato sin verificar');
    const byId = new Map(), quarantined = new Set();
    let summariesOmitted = 0;
    for (const raw of found) {
      if ([raw.title,raw.locality,raw.region].some(detectsPersonalData)) {
        quarantined.add(raw.id);
        continue;
      }
      const old = oldById.get(raw.id);
      if (source.id === 'coen' && !raw.publishedAt && old?.publishedAt) raw.publishedAt = old.publishedAt;
      reuseDetail(raw, old);
      if (detectsPersonalData(raw.summary)) {
        delete raw.summary;
        summariesOmitted++;
      }
      const item = prepareItem(raw, source, old, checkedAt);
      if (item && keepRecent(item, current)) byId.set(item.id, item);
    }
    // Preserve a short history of COEN reports and links that leave rolling media feeds.
    if (source.id === 'coen' || !officialIds.has(source.id)) {
      for (const item of records) if (!byId.has(item.id) && !quarantined.has(item.id) && keepRecent(item, current)) byId.set(item.id, item);
    }
    const result = [...byId.values()].sort((a,b) => (fechaPeru(byTime(b)) || 0) - (fechaPeru(byTime(a)) || 0));
    if (source.id === 'enfen') result.splice(1);
    return {source: {...display, status:'ok', checkedAt, lastSuccessAt: checkedAt, count: result.length,
      ...(quarantined.size ? {withheld:quarantined.size} : {}), ...(summariesOmitted ? {summariesOmitted} : {})}, records:result};
  } catch (error) {
    const diagnosis = officialIds.has(source.id) && source.id.startsWith('senamhi-')
      ? {errorCode:sourceFailureCode(error)} : {};
    if (diagnosis.errorCode) console.warn('Consulta oficial pendiente',source.id,diagnosis.errorCode);
    const retained = records.filter(item => keepRecent(item, current));
    return {
      source: {...display, status: former?.lastSuccessAt ? 'stale' : 'error', checkedAt, lastSuccessAt: former?.lastSuccessAt || null, count: retained.length, ...diagnosis},
      records: retained,
    };
  }
}

export async function refreshPanorama(previous = {}, {now = new Date(), force = false} = {}) {
  force ||= previous.schemaVersion !== 2;
  const results = new Array(providers.length);
  let cursor = 0;
  async function worker() {
    while (cursor < providers.length) {
      const index = cursor++;
      results[index] = await collect(providers[index], previous, now, force);
    }
  }
  await Promise.all(Array.from({length: 6}, worker));
  return {
    schemaVersion: 2, updatedAt: now.toISOString(), sources: results.map(row => row.source),
    items: results.flatMap(row => row.records).sort((a,b) => (fechaPeru(byTime(b)) || 0) - (fechaPeru(byTime(a)) || 0)),
    bulletin: previous.bulletin || null,
  };
}
