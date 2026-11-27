// The COEN emergency feed/archive and regional press connectors are read by
// oficiales.mjs and medios.mjs. Link every detail to its own dated edition.
import { createHash } from 'node:crypto';
import { coenUrl, decodeCoenHtml, downloadCoen, extractCoenPdf } from './coen-documentos.mjs';
import { fechaParteCoen } from './oficiales.mjs';
import { mediaSources } from './medios.mjs';
import { detectsPersonalData } from './privacidad.mjs';
import { localImpactFromItem } from './partes-territoriales.mjs';

const day = 86400000;
const media = new Map(mediaSources.filter(s => s.kind === 'prensa').map(s => [s.id, s]));
const geography = 'Amazonas|Áncash|Apurímac|Arequipa|Ayacucho|Cajamarca|Callao|Cusco|Huancavelica|Huánuco|Ica|Junín|La Libertad|Lambayeque|Lima|Lima Metropolitana|Loreto|Madre de Dios|Moquegua|Pasco|Piura|Puno|San Martín|Tacna|Tumbes|Ucayali'.split('|');
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const clean = html => decodeCoenHtml(html.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const words = value => fold(value).replace(/[^a-z0-9]+/g,' ').trim();
const cases = /^(?:reporte (?:complementario|preliminar)|informe de emergencia)\b/;
const hazards = /\b(?:lluvias?|inund\w+|huaicos?|huaycos?|desbord\w+|oleajes?|deslizamientos?|derrumbes?|graniz\w+|quebradas?|tormentas?)\b/;
const impacts = /\b(?:inund[ao](?:n|das?|dos?)?|anegad[ao]s?|desbordo|desborda|interrump\w*|aislad\w*|evacu\w*|afectad\w*|danos|destru\w+|colaps\w+|damnificad\w*|restablec\w*|aguas (?:acumuladas|servidas|sucias))\b/;
const prospective = /\b(?:riesgo de|podria[n]?|simulacro|se prepara[n]?|prevend\w*|preveni\w*|amenaza con|para evitar|alerta de|advertencia de|se espera[n]?|pronostic\w*)\b/;

function name(raw) {
  const text = String(raw ?? '').trim().replace(/\s+/g,' ');
  if (text.length < 2 || text.length > 70 || !/^[\p{L}][\p{L}'’ -]+$/u.test(text) ||
      /\b(?:distritos?|provincias?|sectores?|departamentos?|inform[oó]|donde|ocasion[oó]|afectad[oa]s?|debido|ubicado|ubicada|se report)/iu.test(text)) return undefined;
  if (text === text.toLocaleUpperCase('es')) {
    return text.toLocaleLowerCase('es').replace(/(^|[ -])(\p{L})/gu, (_, start, ch) => start + ch.toLocaleUpperCase('es'))
      .replace(/\b(De|Del|La|Los|El|Las)\b/g,(part,__,offset) => offset ? part.toLowerCase() : part);
  }
  return text;
}
function location(body, level) {
  const hit = body.match(new RegExp('\\b' + level + ' (?:de |del )?([\\p{L}][\\p{L} ’\'-]{1,75}?)(?=\\s*[,.;:()–—]|\\s+(?:en (?:el|la)|y (?:el|la)|registró|fue|ubicad[oa])\\b|$)', 'iu'));
  if (!hit || /\s+y\s+/i.test(hit[1])) return undefined;
  return name(hit[1]);
}
function sourceArticleUrl(value, src) {
  try {
    const u = new URL(value);
    const host = s => s.toLowerCase().replace(/^www\./,'');
    if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.pathname === '/' ||
        host(u.hostname) !== host(new URL(src.url).hostname)) return;
    u.hash = '';
    return u.href;
  } catch { return; }
}
function localDate(text) {
  const m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d\d)(?:\s+(?:a las\s+)?(\d{1,2}):(\d\d))?\b/i);
  if (!m) return;
  const date = [m[3],m[2].padStart(2,'0'),m[1].padStart(2,'0')].join('-');
  const valid = Date.parse(date);
  if (!Number.isFinite(valid) || new Date(valid).toISOString().slice(0,10) !== date) return;
  if (!m[4]) return date;
  if (+m[4] > 23 || +m[5] > 59) return;
  return new Date(date + 'T' + m[4].padStart(2,'0') + ':' + m[5] + ':00-05:00').toISOString();
}

const rainAdvice = {
  text: 'Evita cruzar cauces de ríos, quebradas y zonas inundadas.',
  source: 'INDECI', url: 'https://www.gob.pe/institucion/indeci/noticias/1369382-indeci-brinda-recomendaciones-ante-temporada-de-lluvias-intensas',
};
const reportNumber = title => fold(title).match(/^(?:informe de emergencia|reporte (?:complementario|preliminar)(?: de emergencia)?)\s+n\s*[.°ºo\s]*(\d{1,6})\b/)?.[1];
function makeBase(item, now) {
  const title = item.title || '';
  if (detectsPersonalData(title) || !item.id || !title) return;
  const official = item.sourceId === 'coen';
  const text = fold(title);
  if (!hazards.test(text)) return;
  const region = item.regions?.length === 1 && geography.includes(item.regions[0]) ? item.regions[0] : undefined;
  if (!region) return;
  if (!official && region === 'Lima' && /\blima (?:sur|norte|este|oeste|metropolitana)\b/.test(text)) return;
  const reportedAt = official ? fechaParteCoen(title, true) : item.publishedAt;
  if (!reportedAt || !Number.isFinite(Date.parse(reportedAt)) || Date.parse(reportedAt) < +now - 7*day || Date.parse(reportedAt) > +now + 300000) return;
  let source, url;
  if (official) {
    if (!cases.test(text) || !reportNumber(title)) return;
    url = coenUrl(item.url);
    source = 'COEN · INDECI';
  } else {
    const src = media.get(item.sourceId);
    if (!src || !impacts.test(text) || prospective.test(text)) return;
    url = sourceArticleUrl(item.url, src);
    source = src.name;
  }
  if (!url) return;
  const district = official ? name(title.match(/\bdistrito de\s+([\p{L} ’'-]+?)\s*(?:[–—]|\s-\s)[^–—]+$/iu)?.[1]) : location(title, 'distrito');
  const headline = official ? (title.match(/\bHORAS\b\s*(?:\([^)]*\)\s*)?(.+)$/i)?.[1] || title) : title;
  let displayTitle = official && headline === headline.toLocaleUpperCase('es')
    ? headline.charAt(0) + headline.slice(1).toLocaleLowerCase('es') : headline;
  if (official && district) displayTitle = displayTitle.replace(/(distrito de )(.+?)(\s*[–—]\s*|\s+-\s+)(.+)$/i,(_,prefix,found,separator,tail)=>prefix+district+separator+(geography.find(n=>fold(n)===fold(tail)) || tail));
  const id = item.sourceId + '-' + createHash('sha256').update(url).digest('hex').slice(0,18);
  const recommendations = official && /lluvia|huayco|huaico|inundaci|desborde/.test(text) ? [rainAdvice] : [];
  return {
    id, itemId:item.id, sourceId:item.sourceId, kind:official?'oficial':'prensa', source, url, title:displayTitle,
    region, ...(district && {district}), reportedAt, status:'reportado', summary:'',
    ...(official && {editionNumber:reportNumber(title)}),
    layer:/\boleajes?\b/.test(text)?'mar':/\b(?:rio|rios|desborde|fluvial)\b/.test(text)?'rios':'lluvias',
    revision: createHash('sha256').update(title + '\n' + reportedAt).digest('hex').slice(0,16),
    timeline:[{at:reportedAt,text:official?'COEN publicó este parte.':source+' publicó la nota.',source,url}],
    evidence:[{type:'documento', label:official?'Ficha de la emergencia':'Nota original',source,url,date:reportedAt}],
    recommendations, contributors:[],
  };
}

function territorialCase(item, event, now) {
  if (!event || !geography.includes(event.region) || !['lluvias','rios','mar'].includes(event.layer)) return;
  const age = +now-Date.parse(event.reportedAt);
  if (!(age>=-300000 && age<=7*day) || !item.id || !event.title || !event.url || detectsPersonalData(event.title) || detectsPersonalData(event.summary)) return;
  const itemId = item.id, sourceId = item.sourceId;
  const id = sourceId+'-'+createHash('sha256').update(event.url).digest('hex').slice(0,18);
  const revision = createHash('sha256').update(JSON.stringify([event.title,event.summary,event.reportedAt,event.evidence])).digest('hex').slice(0,16);
  const timeline = event.timeline?.length ? event.timeline : [{at:event.reportedAt,text:'La entidad publicó el reporte.',source:event.source,url:event.url}];
  const evidence = event.evidence?.length ? event.evidence : [{type:'documento',label:'Publicación de la entidad',source:event.source,url:event.url,date:event.reportedAt,dateKind:'publicacion'}];
  const recommendations = event.layer==='lluvias' && /lluvia|huayco|huaico|inundaci/.test(fold(event.title)) ? [rainAdvice] : [];
  const checkedAt = item.lastChangedAt || item.firstSeenAt;
  return {...event,id,itemId,sourceId,kind:'oficial',status:'reportado',timeline,evidence,recommendations,contributors:[],revision,
    ...(Date.parse(checkedAt)<=+now && {checkedAt})};
}

export function parseCoenImpactPage(html, title) {
  const heading = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].find(m=>words(clean(m[1])) === words(title));
  if (!heading) return;
  const article = html.slice(heading.index + heading[0].length).match(/<div\b[^>]*class=["']article["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!article) return;
  const urls = [...new Set([...article.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .filter(m => /\b(?:download|btn-download)\b/i.test(m[0])).map(m => coenUrl(m[1],true)).filter(Boolean))];
  const result = urls.length === 1 ? {pdfUrl:urls[0]} : {};
  const table = [...article.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find(m => /fecha y hora de (?:la )?ocurrencia/i.test(clean(m[1])));
  if (!table) return result;
  const facts = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(row => {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));
    if (cells.length !== 2 || !localDate(cells[0]) || detectsPersonalData(cells[1])) return [];
    return [{occurredAt:localDate(cells[0]),text:cells[1]}];
  });
  // Several rows can refer to distinct districts or sectors. Never assign
  // all damages/occurrence times to the first place listed.
  if (facts.length === 1) Object.assign(result, facts[0]);
  return result;
}
function attachment(type, label, url, date, page) {
  return {type,label,source:'COEN · INDECI',url:page ? url+'#page='+page : url,date,dateKind:'publicacion',...(page && {page})};
}
const months = 'ene feb mar abr may jun jul ago sep oct nov dic'.split(' ');
function photoDetails(page, reportedAt) {
  const lines = page.split(/distribuci[oó]n:/i,1)[0].split(/\n/).map(l=>l.trim().replace(/\s+/g,' ')).filter(Boolean);
  const dates = [];
  for (const line of lines) {
    const m = fold(line).match(/^(\d\d?)\s+(?:de\s+)?([a-z]{3,10})\.?\s+(?:de(?:l)?\s+)?(20\d\d)$/);
    if (!m) continue;
    const mo = months.indexOf(m[2].replace(/^set/,'sep').slice(0,3))+1;
    const date=mo && localDate(m[1]+'/'+mo+'/'+m[3]);
    if (date && date<=reportedAt.slice(0,10)) dates.push(date);
  }
  const locationCaptions = lines.filter(l=>l.length<=140 && /\b(?:distrito|provincia|caser[ií]o|sector|localidad|centro poblado) (?:de |del )?/i.test(l) && !detectsPersonalData(l));
  return {
    ...(new Set(dates).size===1 && {date:dates[0],dateKind:'anexo'}),
    ...(locationCaptions.length===1 && {caption:locationCaptions[0]}),
  };
}
function targetLocation(event, facts) {
  const district = location(facts, 'distrito');
  const province = location(facts, 'provincia');
  const locality = location(facts, '(?:sector|caserío|centro poblado|localidad)');
  if (district && event.district && words(district) !== words(event.district)) return {};
  return { ...(district && {district}), ...(province && {province}), ...(locality && {locality}) };
}
function summarizeEffects(facts) {
  const f = fold(facts);
  const effects = [];
  if (/activ(?:o|aron|acion de) (?:las? |una? )?quebradas?/.test(f)) effects.push('Activación de quebradas');
  if (/infraestructura de transporte|danos a la (?:carretera|via)/.test(f)) effects.push('afectación de vías');
  if (/danos[^.;]{0,100}(?:viviendas?|infraestructura de vivienda)|viviendas? (?:afectadas?|danadas?|destruidas?)/.test(f)) effects.push('daños en viviendas');
  if (/danos[^.;]{0,100}infraestructura (?:de )?educativa/.test(f)) effects.push('daños en infraestructura educativa');
  if (/inundacion|inundo|inundaron/.test(f)) effects.push('inundación');
  if (!effects.length) return '';
  const msg = effects.join(' y ');
  return msg.charAt(0).toUpperCase()+msg.slice(1)+'.';
}
function applyPage(event, detail) {
  if (!detail?.text || !detail.occurredAt || Date.parse(detail.occurredAt)>Date.parse(event.reportedAt)+300000) return;
  Object.assign(event,targetLocation(event,detail.text));
  event.occurredAt = detail.occurredAt;
  event.summary = summarizeEffects(detail.text);
  event.timeline.unshift({at:detail.occurredAt,text:event.summary || 'Ocurrió el evento descrito en la ficha.',source:event.source,url:event.url});
}
export function applyImpactPdf(event, text, pdfUrl, title) {
  const pages = text.split('\f').filter(p=>p.trim());
  if (!pages.length || !coenUrl(pdfUrl,true)) return false;
  const first = pages[0].trimStart().replace(/\s+/g, ' ');
  if (!reportNumber(title) || reportNumber(first) !== reportNumber(title) || fechaParteCoen(first,true) !== event.reportedAt) return false;
  event.evidence.push(attachment('documento','Reporte oficial en PDF',pdfUrl,event.reportedAt));
  for (const [i,page] of pages.entries()) {
    const heading = fold(page.trimStart().split(/\n/).slice(0,9).join(' ')).replace(/\s+/g,' ').trim();
    if (/^(?:anexo(?:\s*n?[.°º\s]*\d+)?\s*[:.\-]?\s*)?(?:vistas?|panel(?:es)?|registros?) fotografic[oa]s?\b/.test(heading)) {
      event.evidence.push({...attachment('fotos','Anexo fotográfico',pdfUrl,event.reportedAt,i+1),...photoDetails(page,event.reportedAt)});
    } else if (/^(?:anexo(?:\s*n?[.°º\s]*\d+)?\s*[:.\-]?\s*)?(?:mapa|croquis) (?:de (?:la )?)?(?:ubicacion|afectacion|localizacion)/.test(heading)) {
      event.evidence.push(attachment('mapa','Mapa publicado por COEN',pdfUrl,event.reportedAt,i+1));
    }
  }
  const full = pages.join('\n');
  const references = [];
  const attribution = fold(full).replace(/\s+/g,' ');
  const cited = institution => new RegExp('(?:fuente\\s*:\\s*[^.;]{0,90}'+institution+'|'+institution+'[^.;]{0,100}?(?:inform[oó]|mediante su reporte))').test(attribution);
  if (cited('(?:coer|centro de operaciones de emergencia regional)')) references.push('Centro de Operaciones de Emergencia Regional (COER)');
  if (cited('(?:coel|centro de operaciones de emergencia local)')) references.push('Centro de Operaciones de Emergencia Local (COEL)');
  if (cited('municipalidad distrital')) references.push('Municipalidad distrital');
  if (cited('municipalidad provincial')) references.push('Municipalidad provincial');
  event.contributors = references.map(source => ({source,url:pdfUrl}));
  const latestPage = pages.findIndex(page=>/informaci[oó]n contextual/i.test(page));
  if (latestPage >= 0) {
    const contextual = fold(pages[latestPage]).split(/informacion contextual/)[1].split(/(?:\n\s*\d+\.|acciones de respuesta|distribucion:)/)[0];
    // A road being passable is specific to transport; overall closure of
    // the emergency requires a separate explicit statement by the issuer.
    if (/(?:^|[:.;]\s*)transito (?:vehicular y peatonal|peatonal y vehicular|vehicular|peatonal) restablecido\b/.test(contextual.replace(/\s+/g,' '))) {
      const url = pdfUrl+'#page='+(latestPage+1);
      event.recovery = {text:'El parte registra el restablecimiento del tránsito en el tramo indicado.',at:event.reportedAt,source:event.source,url};
      event.timeline.push({at:event.reportedAt,text:event.recovery.text,source:event.source,url});
    } else if (/(?:^|[:.;]\s*)transito (?:vehicular y peatonal|peatonal y vehicular|vehicular) (?:totalmente interrumpido|interrumpido totalmente)\b/.test(contextual.replace(/\s+/g,' ')) && !/restableci|normaliz|reabri|habilitad|reanud/.test(contextual)) {
      event.severe = true;
      event.severityEvidence = {text:'El parte confirma una interrupción total del tránsito en el tramo indicado.', source:event.source, url:pdfUrl+'#page='+(latestPage+1), at:event.reportedAt};
    }
  }
  const section = fold(full).split(/\bdesarrollo de acciones\b/)[1] || '';
  const times = [...section.matchAll(/^\s*(\d{2}:\d{2}) horas\s*$/gm)];
  const latestActions = times.length ? section.slice(times[0].index, times[1]?.index || section.length).split(/\b(?:fuentes|control de cambios)\s*:/)[0] : '';
  if (times[0] && title.includes(times[0][1]) && /la emergencia ha sido atendida,?\s+se procede al cierre del reporte/.test(latestActions)) {
    event.status = 'atendido';
    event.resolved = true;
    delete event.severe;
    delete event.severityEvidence;
    event.timeline.push({at:event.reportedAt,text:'COEN comunica la atención de la emergencia y el cierre del reporte.',source:event.source,url:pdfUrl});
  }
  const sourcesSection = full.split(/\d+\.\s*FUENTES\s*:/i)[1]?.split(/\n\s*\d+\.\s+/)[0] || '';
  for (const m of sourcesSection.matchAll(/^\s*[-•]\s*((?:REPORTE (?:COMPLEMENTARIO|PRELIMINAR)|INFORME DE EMERGENCIA) [^\n]{4,190}HORAS)\s*$/gim)) {
    const at = fechaParteCoen(m[1]);
    const number = reportNumber(m[1]);
    if (at && number && Date.parse(at) < Date.parse(event.reportedAt) && (!event.occurredAt || Date.parse(at)>=Date.parse(event.occurredAt))) {
      (event.priorReports ||= []).push({number,at});
      event.timeline.push({at,text:'COEN cita el parte anterior n.º '+number+'.',source:event.source,url:pdfUrl});
    }
  }
  return true;
}

// NewsArticle metadata belongs to the story itself. Related articles, generic
// OpenGraph covers and the publisher's social posts do not establish an impact.
export function applyPressPage(event, html, now) {
  const src = media.get(event.sourceId);
  if (!src) return false;
  let article;
  for (const tag of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const obj = JSON.parse(tag[1]);
      if (obj['@type']==='NewsArticle' && sourceArticleUrl(obj.mainEntityOfPage?.['@id'] || obj.url,src)===event.url &&
          words(obj.headline)===words(event.title)) { article = obj; break; }
    } catch { /* Other schema entries are not required for this story. */ }
  }
  if (!article) return false;
  const pub = Date.parse(article.datePublished);
  if (!/(?:Z|[+-]\d\d:\d\d)$/i.test(article.datePublished) || !Number.isFinite(pub) || Math.abs(pub-Date.parse(event.reportedAt))>60000) return false;
  const body = typeof article.articleBody === 'string' ? clean(article.articleBody).slice(0,1600) : '';
  const lead = typeof article.description === 'string' ? clean(article.description).slice(0,800) : '';
  const observed = lead+' '+body.split(/seg[uú]n el pron[oó]stico|se prev[eé]|hab[ií]a advertido/i)[0];
  event.pressSignature = createHash('sha256').update(lead+'\n'+body).digest('hex').slice(0,16);
  const city = location(lead, 'ciudad');
  // A city name does not by itself identify the homonymous district.
  if (city && geography.includes(city) && city===event.region) event.locality=city;
  if (new RegExp('\\bciudad de '+fold(event.region)+'\\b').test(fold(lead))) event.locality='Ciudad de '+event.region;
  const district = location(lead,'distrito');
  if (district && !/\bdistritos\b/iu.test(lead) && (lead.match(/\bdistrito\b/giu)||[]).length===1) event.district=district;
  const mention = fold(observed);
  const findings = [];
  if (/calles (?:de la ciudad )?(?:se inundaran|inundadas|anegadas)|anegamiento de calles/.test(mention)) findings.push('calles inundadas');
  if (/interrumpido el transito vehicular/.test(mention)) findings.push('interrupciones del tránsito');
  if (/obstruccion de canales de drenaje/.test(mention)) findings.push('canales de drenaje obstruidos');
  if (findings.length) event.summary = event.source+' reporta '+findings.join(' y ')+'.';
  const mediaDate = new Date(pub).toISOString();
  const modified=Date.parse(article.dateModified);
  if (event.sourceId==='rpp' && modified>pub && modified<=+now) {
    event.updatedAt=new Date(modified).toISOString();
    event.timeline.push({at:event.updatedAt,text:'RPP actualizó su nota.',source:event.source,url:event.url});
  }
  const video = Array.isArray(article.video) ? article.video[0] : article.video;
  if (video?.['@type']==='VideoObject' && /\bvideo\b/i.test(event.title)) {
    event.evidence.push({type:'video',label:'Video en la nota original',url:event.url,date:mediaDate,dateKind:'publicacion',source:event.source});
  }
  if (event.sourceId==='andina') {
    const img = [...html.matchAll(/<img\b[^>]+>/gi)].map(m=>m[0]).find(tag=>/class=["'][^"']*\bmarginauto\b/i.test(tag) && /fetchpriority=["']high["']/i.test(tag));
    const alt = img && clean(img.match(/\balt=["']([^"']*)["']/i)?.[1] || '');
    // Link to the original credit. The agency retains the image; the app
    // does not republish or imply reuse rights for a press photograph.
    if (alt && /\bANDINA(?:\/|\b)/i.test(alt) && !/archivo|referencial|ilustraci[oó]n/i.test(alt) && hazards.test(fold(alt)) && fold(alt).includes(fold(event.region))) {
      event.evidence.push({type:'fotos',label:'Fotografía acreditada en la nota',source:/ANDINA\/Difusi[oó]n/i.test(alt)?'Andina / Difusión':'Andina',url:event.url,date:mediaDate,dateKind:'publicacion'});
    }
  }
  return true;
}

async function readPressPage(url) {
  const res=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(7000),headers:{Accept:'text/html'}});
  if (!res.ok || !res.headers.get('content-type')?.startsWith('text/html')) {await res.body?.cancel();throw Error('Nota de prensa no disponible');}
  const chunks=[];
  let size=0;
  for await (const chunk of res.body) {
    size+=chunk.byteLength;
    if (size>900000) throw Error('Nota de prensa demasiado grande');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readImpactPage(url) { return (await downloadCoen(url)).body.toString('utf8'); }
async function readImpactPdf(url) { return extractCoenPdf((await downloadCoen(url,true)).body,true); }

// Keep stable records across a temporary outage. Revision changes invalidate
// facts from the former PDF, including a former recovery or closure.
export async function buildLocalImpacts({items=[], previous, now=new Date(), readPage=readImpactPage, readPdf=readImpactPdf, readPress=readPressPage, limit=9, pressLimit=4}={}) {
  now = new Date(now);
  const old = new Map((previous?.schemaVersion===1 ? previous.events || [] : []).map(e=>[e.id,e]));
  const records = new Map();
  const removed = new Set(items.filter(i=>i.withdrawnAt || i.supersededBy).map(i=>i.url));
  const queue = [], pressQueue = [];
  for (const item of [...items].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))) {
    const base = territorialCase(item,localImpactFromItem(item),now) || makeBase(item,now);
    if (!base || removed.has(item.url) || records.has(base.id)) continue;
    let cached = old.get(base.id);
    if (cached?.feedArchived) {
      const {feedArchived,...present} = cached;
      cached=present;
    }
    const same = cached?.revision===base.revision;
    records.set(base.id,same ? cached : base);
    const lastCheck = same && (cached.attemptedAt || cached.checkedAt);
    if (lastCheck && +now-Date.parse(lastCheck)<(cached.pdfVerified || cached.checkedAt && base.kind==='prensa' ? day/4 : day/24)) continue;
    if (base.sourceId==='coen' || ['andina','rpp'].includes(base.sourceId)) {
      (base.sourceId==='coen' ? queue : pressQueue).push({base,title:item.title,cached:same ? cached : null});
    }
  }
  const byAttempt = (a,b)=>(Date.parse(a.cached?.attemptedAt || a.cached?.checkedAt)||0)-(Date.parse(b.cached?.attemptedAt || b.cached?.checkedAt)||0);
  const work = [...queue.sort(byAttempt).slice(0,limit),...pressQueue.sort(byAttempt).slice(0,pressLimit)];
  async function worker() {
    for (let task; (task = work.shift());) {
      const {base,title,cached} = task;
      // A failed attempt rotates behind unread documents on the following run.
      records.set(base.id,{...(cached || base),attemptedAt:now.toISOString()});
      try {
        if (base.kind==='prensa') {
          if (applyPressPage(base,await readPress(base.url),now)) {
            // Preserve dated, editorially cross-checked evidence across
            // metadata refreshes of the exact same publication.
            if (cached?.reviewedCase && cached.pressSignature===base.pressSignature) {
              records.set(base.id,{...cached,checkedAt:now.toISOString()});
              continue;
            }
            base.checkedAt=now.toISOString();
            records.set(base.id,base);
          }
          continue;
        }
        const details = parseCoenImpactPage(await readPage(base.url),title);
        if (!details) continue;
        applyPage(base,details);
        if (details.pdfUrl) {
          try {
            const pdf = await readPdf(details.pdfUrl);
            base.pdfVerified = applyImpactPdf(base,pdf,details.pdfUrl,title);
          } catch { /* The signed HTML still contains independently verifiable facts. */ }
        }
        if (cached?.pdfVerified && !base.pdfVerified && details.pdfUrl === cached.evidence.find(e=>e.label==='Reporte oficial en PDF')?.url) continue;
        base.checkedAt = now.toISOString();
        base.timeline = [...new Map(base.timeline.map(e=>[e.at+' '+e.text,e])).values()].sort((a,b)=>a.at.localeCompare(b.at));
        records.set(base.id,base);
      } catch { /* A source outage never changes an official date. */ }
    }
  }
  await Promise.all([worker(),worker(),worker()]);
  const presentUrls = new Set(items.map(i=>i.url));
  // Feed windows can roll before the retention window for a dated case.
  // Keep previously verified history with its original timestamps. An
  // explicit withdrawal, new edition or expiry takes precedence.
  for (const cached of old.values()) {
    const age = +now-Date.parse(cached.reportedAt);
    if (!cached.checkedAt || !(age>=0 && age<=7*day) || presentUrls.has(cached.url) || records.has(cached.id)) continue;
    records.set(cached.id,{...cached,feedArchived:true,...(cached.severe && {severe:false})});
  }
  const merged = new Set();
  const earlierReports = new Map([...records.values()].filter(e=>e.sourceId==='coen' && e.editionNumber && e.district)
    .map(e=>[[e.editionNumber,e.reportedAt,e.region,words(e.district),e.layer].join('|'),e]));
  for (const record of records.values()) {
    for (const ref of record.priorReports || []) {
      const earlier = earlierReports.get([ref.number,ref.at,record.region,words(record.district),record.layer].join('|'));
      if (earlier && earlier.id!==record.id && (!earlier.occurredAt || !record.occurredAt || earlier.occurredAt===record.occurredAt)) merged.add(earlier.id);
    }
    if (!record.reviewedCase || !record.corroborated) continue;
    for (const link of record.relatedItems || []) {
      if (record.id!==link.id && records.get(link.id)?.revision===link.revision) merged.add(link.id);
    }
  }
  const events = [...records.values()].filter(e=>!merged.has(e.id))
    .map(e=>e.severe && +now-Date.parse(e.reportedAt)>6*3600000 ? {...e,severe:false} : e)
    .sort((a,b)=>b.reportedAt.localeCompare(a.reportedAt) || a.title.localeCompare(b.title,'es'));
  return {schemaVersion:1,checkedAt:now.toISOString(),events};
}
