// Share only opaque record identities. Destinations come from this release's source
// parsers or the publisher's public archive; user-provided URLs are never followed.
const sunassDirectory='https://aplicaciones.sunass.gob.pe/Interrupciones/consultaInterrupcion.html';
const radarBase = 'https://www.senamhi.gob.pe/prod/sismet/v1/api/v1/public/resources/';
const kinds = {observacion:'o', pronostico:'p', impacto:'e', estacion:'h', aviso:'a', puerto:'m'};
const tokenPattern = /^1\.([iopeham])\.([A-Za-z0-9_-]{22})\.(x|s\d{1,12}|r[1-9a-z][0-9a-z]{0,8}|u[A-Za-z0-9_-]{22})$/;
const originalPattern = /^u[A-Za-z0-9_-]{22}$/;
const utf8 = new TextEncoder();
const memo = new Map();
const rootArticleHosts = new Set(['walac.pe','pachamamaradio.org','diariovoces.com.pe']);
const pressHosts = new Set(['eltiempo.pe','cutivalu.pe','elbuho.pe','radiolavozdelaselva.org']);

function compactHash(text) {
  let promise=memo.get(text);
  if (!promise) {
    promise=crypto.subtle.digest('SHA-256',utf8.encode(text)).then(buffer =>
      btoa(String.fromCharCode(...new Uint8Array(buffer,0,16))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''));
    if (memo.size>=2048) memo.delete(memo.keys().next().value);
    memo.set(text,promise);
  }
  return promise;
}
function permittedQuery(url,fields) {
  const entries=[...url.searchParams];
  return entries.length===Object.keys(fields).length && entries.every(([k,v])=>
    Object.hasOwn(fields,k) && fields[k].test(v)) && Object.keys(fields).every(k=>url.searchParams.has(k));
}
function senamhiNotice(url) {
  if (url.pathname!=='/' || url.hash) return false;
  const p=url.searchParams.get('p');
  if (p==='aviso-24H') return permittedQuery(url,{p:/^aviso-24H$/,f:/^\d{2}-\d{2}-20\d\d$/});
  if (p==='avisos-detalle-hidrologicos') return permittedQuery(url,{p:/^avisos-detalle-hidrologicos$/,ca:/^\d{1,12}$/,ce:/^[a-z\d]{1,12}$/i});
  if (p==='aviso-meteorologico-vigente' || p==='aviso-meteorologico-detalle') return permittedQuery(url,{p:/^aviso-meteorologico-(?:vigente|detalle)$/,a:/^20\d\d$/,b:/^\d{1,12}$/,c:/^\d{1,3}$/,d:/^SENA$/});
  return false;
}

// Rolling front pages cannot serve as the original of an expired notice.
export function validatedOriginal(raw) {
  if (typeof raw!=='string' || raw.length>1800 || !raw.startsWith('https://') ||
      /[\x00-\x20\x7f\\]|%(?:00|0a|0d|2e|2f|5c|25)/i.test(raw)) return null;
  let url, path;
  try {url=new URL(raw);path=decodeURIComponent(url.pathname);} catch {return null;}
  if (url.username || url.password || url.port || /(?:\/\/|\/\.\.(?:\/|$)|[?#])/.test(path)) return null;
  const host=url.hostname.replace(/^www\./,'');
  if (url.hash && !/^#page=[1-9]\d{0,3}$/.test(url.hash)) return null;
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_[a-z]+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  if (host==='senamhi.gob.pe' && url.hostname==='www.senamhi.gob.pe' && senamhiNotice(url)) return url.href;
  if (host==='youtube.com' && url.pathname==='/watch' && !url.hash && permittedQuery(url,{v:/^[\w-]{11}$/})) return url.href;
  if (url.search || (url.hash && !/\.pdf$/i.test(path))) return null;
  let allowed=false;
  if (host==='youtube.com') {
    allowed=/^\/shorts\/[\w-]{11}$/.test(path);
  } else if (host==='senamhi.gob.pe' && url.hostname==='www.senamhi.gob.pe') {
    allowed=/^\/prod\/sismet\/v1\/api\/v1\/public\/resources\/[1-9]\d{0,12}\/file$/.test(path) ||
      /^\/load\/(?:aq-aviso-shape|aviso-24h-shape)\/[a-z\d_-]+20\d{2}-\d{2}-\d{2}\.zip$/i.test(path);
  } else if (host==='portal.indeci.gob.pe') {
    allowed=/^\/emergencias\/[a-z\d-]+\/?$/i.test(path) ||
      /^\/wp-content\/uploads\/20\d\d\/(?:0[1-9]|1[012])\/[^/<>]+\.pdf$/iu.test(path);
  } else if (host==='gob.pe' && url.hostname==='www.gob.pe') {
    allowed=/^\/institucion\/(?:munipiura|munitumbes)\/noticias\/\d+-[a-z\d-]+\/?$/i.test(path);
  } else if (host==='dhn.mil.pe') {
    allowed=/^\/portal\/pdf-aviso-especial\/\d+$/.test(path);
  } else if (host==='dicapi.mil.pe') {
    allowed=/^\/storage\/state-ports\/[a-f\d-]{36}\.pdf$/i.test(path);
  } else if (host==='enfen.imarpe.gob.pe') {
    allowed=/^\/20\d{2}\/\d{2}\/\d{2}\/[a-z\d-]+\/?$/i.test(path);
  } else if (host==='andina.pe') {
    allowed=/^\/agencia\/noticia-[a-z\d-]+-\d+\.aspx$/i.test(path);
  } else if (host==='rpp.pe') {
    allowed=/^\/(?:[a-z\d-]+\/){1,5}[a-z\d-]+-noticia-\d+\/?$/i.test(path);
  } else if (host==='elcomercio.pe') {
    // The publisher's canonical article URLs end in -noticia, including section-local routes.
    allowed=/^\/(?:[a-z\d-]+\/){1,4}[a-z\d-]+-noticia\/?$/i.test(path);
  } else if (rootArticleHosts.has(host) || url.hostname==='newstrujillo.com') {
    allowed=/^\/[a-z\d]+(?:-[a-z\d]+)+\/?$/i.test(path);
  } else if (host==='radiouno.pe') {
    allowed=/^\/noticias\/[1-9]\d{0,11}\/[a-z\d]+(?:-[a-z\d]+)+\/?$/i.test(path);
  } else if (pressHosts.has(host)) {
    allowed=/^\/(?:[a-z\d-]+\/){0,4}[a-z\d]+(?:-[a-z\d]+){2,}\/?$/i.test(path);
  }
  return allowed ? url.href : null;
}
function originalOf(record) {
  const entry=record?.item || record?.event || record;
  if (!entry) return null;
  const evidence=Array.isArray(entry.evidence) ? entry.evidence : [];
  const pdf=evidence.find(e=>e?.type==='documento' && /\.pdf(?:#|$)/i.test(e.url || ''));
  // An edition-specific original takes precedence over a mutable agency page.
  return [entry.coenDocument?.pdfUrl,pdf?.url,entry.url,entry.shapeArchiveUrl].map(validatedOriginal).find(Boolean) || null;
}
function radarId(url) {
  return url?.startsWith(radarBase) && url.slice(radarBase.length).match(/^([1-9]\d{0,12})\/file$/)?.[1] || '';
}
function directoryRef(record) {
  const item=record?.item || record;
  const code=item?.sourceId==='sunass' && item.url===sunassDirectory && typeof item.id==='string' && item.id.match(/^sunass:(\d{1,12})$/)?.[1];
  return code ? 's'+code : '';
}
async function reference(url) {
  if (!url) return 'x';
  const id=radarId(url);
  return id ? 'r'+Number(id).toString(36) : 'u'+await compactHash(url);
}
function normalized(v) {return String(v ?? '').normalize('NFC').replace(/\s+/g,' ').trim();}
function identity(record) {
  if (!record || typeof record!=='object' || !record.id) return null;
  const kind=Object.hasOwn(kinds,record.type) ? kinds[record.type] : 'i';
  const item=record.item || record;
  let fields;
  if (kind==='o' || kind==='p') {
    const id=radarId(validatedOriginal(record.url));
    if (!id) return null;
    // Separate stations and districts that quote the same sentence in the same PDF.
    fields=[id,record.region,record.province,record.district,record.locality || record.station,
      record.type==='observacion' ? record.from : record.issuedAt,record.text];
  } else if (kind==='e') {
    const event=record.event || record;
    fields=[event.sourceId,event.id,event.reportedAt || record.at];
  } else if (kind==='m') {
    const url=validatedOriginal(record.url);
    // Some facilities share a resolution. The operational record also identifies the facility.
    fields=[record.id,url,record.at===record.checkedAt && url ? '' : record.at,record.title];
  } else {
    if (!item.sourceId || !item.id) return null;
    // A COEN page may be updated in place with a new numbered edition. Poll
    // times, model summaries, current labels and projected validity days are excluded.
    fields=[item.sourceId,item.id];
    if (item.sourceId==='coen') fields.push(item.publishedAt,item.title);
    if (kind==='h' || item.stationName) fields.push(item.stationName,item.observedAt || item.publishedAt);
  }
  return {kind, canonical:JSON.stringify([kind,...fields.map(normalized)])};
}
export async function avisoKey(record) {
  const id=identity(record);
  if (!id) return '';
  const [fingerprint,original]=await Promise.all([compactHash(id.canonical),directoryRef(record) || reference(originalOf(record))]);
  return '1.'+id.kind+'.'+fingerprint+'.'+original;
}
function nativeRadarLink(ref) {
  const id=parseInt(ref.slice(1),36);
  if (!Number.isSafeInteger(id) || id<1 || id>9999999999999 || id.toString(36)!==ref.slice(1)) return null;
  return radarBase+id+'/file';
}
export async function resolveAviso(token,{items=[],signals=[],originals={}}={}) {
  const match=typeof token==='string' && token.length<=72 && token.match(tokenPattern);
  if (!match) return {kind:'invalid'};
  const [,kind,target,ref]=match;
  const records=kind==='i' ? items : signals;
  const candidates=records.map(record=>({record,id:identity(record)})).filter(({id})=>id?.kind===kind);
  const matches=await Promise.all(candidates.map(async ({record,id})=>await compactHash(id.canonical)===target ? record : null));
  const record=matches.find(Boolean);
  if (record) return {kind:kind==='i'?'item':'signal',record,originalUrl:originalOf(record)};
  if (kind==='i' && /^s\d{1,12}$/.test(ref) && originals?.[ref]===1)
    return {kind:'missing',sourceDirectoryUrl:sunassDirectory,sourceRecordId:ref.slice(1),sourceName:'SUNASS'};
  let originalUrl=null;
  if (ref.startsWith('r') && ['o','p','i'].includes(kind)) {
    // Restore only a radar resource actually verified by the publisher. An invented
    // numeric ID must not be presented as evidence of a SENAMHI edition.
    const url=nativeRadarLink(ref);
    if (url && (originals && Object.hasOwn(originals,ref) && originals[ref]===1 ||
        [...items,...signals].some(entry=>originalOf(entry)===url))) originalUrl=url;
  } else if (originalPattern.test(ref) && originals && Object.hasOwn(originals,ref)) {
    const url=validatedOriginal(originals[ref]);
    if (url && await reference(url)===ref) originalUrl=url;
  }
  return originalUrl ? {kind:'archived',originalUrl} : {kind:'missing'};
}

// One canonical source URL per document, independently of the number of map
// features or publications using it. Radar references already contain the official resource ID.
export async function buildOriginalIndex({items=[],signals=[],previous={}}={}) {
  const urls=new Set();
  const result=Object.create(null);
  for (const row of [...items,...signals]) {
    const directory=directoryRef(row);
    if (directory) result[directory]=1;
    const url=originalOf(row);
    if (url) urls.add(url);
  }
  const current=await Promise.all([...urls].map(async url=>[await reference(url),radarId(url) ? 1 : url]));
  for(const [key,value] of current)result[key]=value;
  // Every visitor downloads the edition. Keep all current sources, then the most
  // recently seen originals within one MiB. Missing older references open the archive notice.
  let bytes=JSON.stringify(result).length;
  for (const [key,url] of Object.entries(previous || {})) {
    if(Object.hasOwn(result,key))continue;
    const isCode=url===1 && (/^s\d{1,12}$/.test(key) || /^r[1-9a-z][0-9a-z]{0,8}$/.test(key) && nativeRadarLink(key));
    if(!isCode && !(originalPattern.test(key) && typeof url==='string' && validatedOriginal(url)===url))continue;
    const size=key.length+(url===1?1:url.length+2)+4;
    if(bytes+size>1024*1024)break;
    result[key]=url;
    bytes+=size;
  }
  return result;
}
