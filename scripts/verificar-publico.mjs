import {constants} from 'node:fs';
import {lstat, open, readdir} from 'node:fs/promises';
import {isIP} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {officialSources} from '../lib/oficiales.mjs';
import {isPhisisRiverEvidence} from '../lib/rios-phisis.mjs';
import {mediaSources} from '../lib/medios.mjs';
import {pii} from '../lib/privacidad.mjs';
import {isTemperatureSnapshot} from '../lib/temperatura.mjs';
import {layerRecords} from '../public/avisos-mapa.mjs';

const registry = new Map([...officialSources, ...mediaSources].map(s => [s.id, s]));
const issuerIds = new Set(officialSources.map(s => s.id));
const extensions = new Set(['.html','.css','.js','.mjs','.json','.txt','.xml','.svg','.jpg','.jpeg','.png','.webp','.avif','.ico','.gif','.woff','.woff2','.wav','.mp3','.webmanifest','.webm','.mp4']);
const blockedName = /(?:^|[._-])(?:env|credentials?|secrets?|private[-_]?key|id_rsa|id_ed25519|node_modules|estado)(?:[._-]|$)/i;
const sensitiveText = [
  /-----BEGIN (?:[\w ]+ )?PRIVATE KEY-----/,
  /\bsk-(?:(?:proj|svcacct|admin|live|test)-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:gh[pousr]_[a-zA-Z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{20,})\b/,
  /\b(?:OPENAI_API_KEY|GITHUB_TOKEN|PRIVATE_KEY|ACCESS_TOKEN|API_SECRET|CLIENT_SECRET)\s*["']?\s*[:=]\s*["']?[^\s"';,{}]{10,}/i,
  /\bBearer\s+[a-z0-9_.-]{30,}/i,
];
const privateField = /^(?:dni|pasaporte|telefono|celular|email|correo|direcciondomiciliaria|nombrepaciente|nombrevictima|nombresdelmenor|numerosuministro|cuentabancaria|apikey|accesstoken|clientsecret|claveprivada|privatekey|password|authorization)$/;
const fold = v => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const label = value => sensitiveText.some(r=>r.test(value)) ? '[nombre reservado]' : value.replace(/[\x00-\x1f\x7f]/g,'?').slice(0,140);
const hostKey = h => h.toLowerCase().replace(/^www\./,'');
const privateHost = h => !h.includes('.') || isIP(h.replace(/^\[|\]$/g,'')) || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)\.?$/i.test(h);
const isText = v => typeof v === 'string' && v.trim().length > 0;
const isTimestamp = v => isText(v) && /^(?:\d{4}-\d{2}-\d{2})(?:T[0-9:.]+(?:Z|[+-]\d\d:\d\d))?$/.test(v) && Number.isFinite(Date.parse(v));

function publicUrl(value, expectedHost) {
  if (!isText(value) || /[\x00-\x20\\]/.test(value)) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || privateHost(u.hostname)) return false;
    if (expectedHost && hostKey(u.hostname)!==hostKey(expectedHost)) return false;
    return ![...u.searchParams.keys()].some(k=>/^(?:access_token|api_key|apikey|client_secret|password|authorization|signature|x-amz-signature)$/i.test(k));
  } catch { return false; }
}

function checkPrivacy(record, fields, where, issues) {
  for (const key of fields) {
    if (typeof record[key]!=='string') continue;
    for (const [why,rx] of pii) if (rx.test(record[key])) issues.push(where+'.'+key+' · '+why+'; revisar antes de publicar');
  }
}

function privateKeys(obj, where, issues) {
  if (!obj || typeof obj!=='object') return;
  for (const [key,v] of Object.entries(obj)) {
    if (privateField.test(fold(key))) issues.push(where+' · campo reservado (valor omitido)');
    if (v && typeof v==='object') privateKeys(v,where,issues);
  }
}

const senamhiNotices = new Set(['senamhi-lluvias','senamhi-quebradas','senamhi-meteo','senamhi-rios']);

function checkCoenDocument(item, asOf, where, issues) {
  if (!item.coenDocument && !item.originNotice && item.regionOrigin!=='pdf-coen') return;
  const doc = item.coenDocument;
  if (item.sourceId!=='coen' || !doc || Array.isArray(doc) || typeof doc!=='object') {
    issues.push(where+' · detalle de COEN sin documento atribuido al emisor');
    return;
  }
  let pathValid = false;
  if (publicUrl(doc.pdfUrl,'portal.indeci.gob.pe')) {
    const pdf = new URL(doc.pdfUrl);
    pathValid = pdf.hostname==='portal.indeci.gob.pe' && !pdf.search && !pdf.hash &&
      /^\/wp-content\/uploads\/20\d{2}\/\d{2}\/[^/]+\.pdf$/i.test(pdf.pathname) &&
      !/[%](?:2f|5c)|[\x00-\x1f]/i.test(pdf.pathname);
  }
  if (!pathValid || !Array.isArray(item.coverageUrls) || !item.coverageUrls.includes(doc.pdfUrl))
    issues.push(where+' · PDF de COEN sin referencia pública válida');
  const keys = new Set(['pdfUrl','sha256','parserVersion','checkedAt','etag','lastModified']);
  if (Object.keys(doc).some(k=>!keys.has(k)) || !/^[a-f0-9]{64}$/i.test(doc.sha256) ||
      !Number.isInteger(doc.parserVersion) || doc.parserVersion < 1 || !isTimestamp(doc.checkedAt) ||
      Date.parse(doc.checkedAt)>asOf+300000)
    issues.push(where+' · metadatos del PDF inválidos');
  if (doc.etag!=null && (typeof doc.etag!=='string' || doc.etag.length>160 || /[\r\n]/.test(doc.etag)))
    issues.push(where+' · validador del PDF inválido');
  checkPrivacy(doc,['etag'],where,issues);
  if (doc.lastModified!=null && (!Number.isFinite(Date.parse(doc.lastModified)) ||
      new Date(doc.lastModified).toUTCString()!==doc.lastModified))
    issues.push(where+' · fecha HTTP del PDF inválida');
  const origin = item.originNotice;
  if (origin && (!senamhiNotices.has(origin.sourceId) || typeof origin.number!=='string' || !/^\d{1,6}$/.test(origin.number) ||
      typeof origin.year!=='string' || !/^20\d{2}$/.test(origin.year) || Object.keys(origin).some(k=>!['sourceId','number','year'].includes(k))))
    issues.push(where+' · referencia original de SENAMHI inválida');
  if (item.invalidValidity && (item.validFrom || item.validUntil))
    issues.push(where+' · documento con vigencia contradictoria');
  checkPrivacy(item,['phenomenon'],where,issues);
  for (const [region,provinces] of Object.entries(item.provincesByRegion ?? {})) {
    if (!Array.isArray(provinces) || !item.regions?.includes(region) || provinces.some(v=>!isText(v))) {
      issues.push(where+' · desglose provincial incoherente'); continue;
    }
    for (const value of [region,...provinces]) checkPrivacy({value},['value'],where,issues);
  }
}

function checkExplanations(p, issues) {
  const e = p.explanations;
  if (e === undefined) return; // An earlier published edition can seed a new run.
  if (e?.schemaVersion !== 1 || !isTimestamp(e.updatedAt) ||
      !e.notices || !e.regions || typeof e.notices !== 'object' || typeof e.regions !== 'object' ||
      Array.isArray(e.notices) || Array.isArray(e.regions)) {
    issues.push('Explicaciones · formato inválido'); return;
  }
  const mapped = new Map(layerRecords(p.items).map(i => [i.id,i]));
  for (const [id,n] of Object.entries(e.notices)) {
    const source = mapped.get(id);
    if (!source || source.kind !== 'oficial' || source.withdrawnAt || !n ||
        !['ia','fuentes'].includes(n.mode) || !/^[a-f0-9]{64}$/.test(n.signature) ||
        !isTimestamp(n.generatedAt) || Date.parse(n.generatedAt) > Date.parse(p.updatedAt) + 60000 ||
        [n.what,n.meaning].some(t => !isText(t) || t.length > 700 || /[<>]/.test(t))) {
      issues.push('Explicaciones · ficha sin respaldo oficial o texto inválido'); continue;
    }
    checkPrivacy(n,['what','meaning'],'explicación regional',issues);
  }
  for (const [area,groups] of Object.entries(e.regions)) {
    if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
      issues.push('Explicaciones · índice regional inválido'); continue;
    }
    for (const [topic,ids] of Object.entries(groups)) {
      if (!['general','lluvias','rios','mar','agua'].includes(topic) || !Array.isArray(ids) ||
          ids.length !== new Set(ids).size || ids.some(id => {
            const it = mapped.get(id);
            return !Object.hasOwn(e.notices,id) || ![...(it?.regions ?? []),...(it?.coastalRegions ?? [])].includes(area);
          })) issues.push('Explicaciones · referencia fuera de su región');
    }
  }
}

function checkSnapshot(p, files, issues, notes) {
  if (!p || typeof p!=='object' || ![1,2].includes(p.schemaVersion) || !isTimestamp(p.updatedAt) || !Array.isArray(p.sources) || !p.sources.length || !Array.isArray(p.items)) {
    issues.push('panorama · estructura, fuentes o fecha de actualización inválidas'); return;
  }
  const asOf = Date.parse(p.updatedAt);
  if (asOf>Date.now()+5*60000) issues.push('panorama · actualización futura');
  if (Date.now()-asOf>2*3600000) notes.push('El panorama tiene más de dos horas. Consultar su hora de corte.');
  privateKeys(p,'panorama',issues);
  const declared=new Map(), counts=new Map(), recordIds=new Set(), snapshotsByUrl=new Set();
  for (const [index,s] of p.sources.entries()) {
    const where='fuente '+index;
    if (!s || !isText(s.id) || !isText(s.name) || !registry.has(s.id) || declared.has(s.id)) {issues.push(where+' · identificación de la fuente inválida'); continue;}
    declared.set(s.id,s);
    const definition=registry.get(s.id);
    if(s.name!==definition.name) issues.push(where+' · nombre público distinto del emisor registrado');
    if (!publicUrl(s.url,new URL(definition.url).hostname)) issues.push(where+' · origen de enlace inválido');
    if (!['ok','stale','error','external'].includes(s.status)) issues.push(where+' · estado desconocido');
    if ((issuerIds.has(s.id)?'oficial':definition.kind)!==s.kind) issues.push(where+' · atribución incorrecta');
    if (s.status==='ok' && (!isTimestamp(s.lastSuccessAt)||!isTimestamp(s.checkedAt)||Date.parse(s.lastSuccessAt)>Date.parse(s.checkedAt)+60000 || Date.parse(s.checkedAt)>asOf+300000)) issues.push(where+' · verificación exitosa sin fecha coherente');
    if (s.status==='stale' && !isTimestamp(s.lastSuccessAt)) issues.push(where+' · datos conservados sin fecha de procedencia');
    if (s.status==='stale'||s.status==='error') notes.push(definition.name+' · '+(s.status==='stale'?'última lectura conservada':'sin lectura en este corte'));
    if (s.status!=='external' && (!Number.isInteger(s.count) || s.count<0)) issues.push(where+' · recuento inválido');
  }
  for (const [index,it] of p.items.entries()) {
    const where='registro '+index;
    if (!it || !isText(it.id) || !isText(it.title) || !declared.has(it.sourceId)) {issues.push(where+' · falta identificador, título o emisor reconocido'); continue;}
    const s=declared.get(it.sourceId);
    if (recordIds.has(it.id)) issues.push(where+' · identificador duplicado');
    recordIds.add(it.id);
    counts.set(it.sourceId,(counts.get(it.sourceId)??0)+1);
    snapshotsByUrl.add(it.url);
    if (it.kind!==s.kind || it.sourceName!==s.name) issues.push(where+' · atribución distinta de su fuente');
    if (!publicUrl(it.url,new URL(registry.get(it.sourceId).url).hostname)) issues.push(where+' · enlace ajeno al emisor o URL inválida');
    for (const field of ['publishedAt','lastChangedAt','validFrom','validUntil','firstSeenAt','updatedAt','expectedRestorationAt','forecastDate']) {
      if (it[field]!=null && !isTimestamp(it[field])) issues.push(where+'.'+field+' · fecha inválida');
    }
    checkPrivacy(it,['title','summary','locality','region'],where,issues);
    checkCoenDocument(it,asOf,where,issues);
    if(it.supersededBy && (!isText(it.supersededBy) || !publicUrl(it.supersededUrl,new URL(registry.get(it.sourceId).url).hostname))) issues.push(where+' · actualización sin referencia del emisor');
    for (const u of it.coverageUrls ?? []) {
      const issuer = publicUrl(u,new URL(registry.get(it.sourceId).url).hostname);
      if (it.kind!=='oficial' || !(issuer || (it.sourceId==='senamhi-rios' && isPhisisRiverEvidence(u)))) issues.push(where+' · visor territorial con origen inválido');
    }
    if (it.sourceId==='senamhi-rios') {
      for (const key of ['observedAt','phisisListedAt','withdrawnAt'])
        if (it[key]!=null && (!isTimestamp(it[key]) || Date.parse(it[key])>asOf+600000)) issues.push(where+' · hora hidrológica inválida');
      checkPrivacy(it,['stationName','stationProvince','stationDistrict'],where,issues);
    }
    for (const part of it.coastalScope ?? []) {
      checkPrivacy(part,['zone','stretch'],where,issues);
      for (const line of part.conditions ?? []) checkPrivacy({line},['line'],where,issues);
    }
  }
  for(const [id,s] of declared){
    if(s.status==='external') continue;
    const included=counts.get(id)??0;
    if(s.status==='ok' && included!==s.count) issues.push(id+' · los registros publicados difieren de los declarados');
  }
  if(!declared.has('coen') || !declared.has('enfen')) issues.push('panorama · faltan las fuentes de referencia COEN/ENFEN');
  if(declared.get('enfen')?.status==='ok' && !p.items.some(i=>i?.sourceId==='enfen' && /comunicado oficial/i.test(i.title) && isTimestamp(i.publishedAt))) issues.push('ENFEN · lectura marcada exitosa sin comunicado oficial fechado');
  if(!p.items.some(it=>it && issuerIds.has(it.sourceId)&&isTimestamp(declared.get(it.sourceId)?.lastSuccessAt))) issues.push('panorama · ningún registro oficial con una fuente verificada');
  checkExplanations(p,issues);
  const b=p.bulletin;
  if(!b)return;
  if(!isText(b.text)||!isTimestamp(b.generatedAt)||!Array.isArray(b.sources)||!b.sources.length) {issues.push('boletín · falta texto, fecha o referencias');return;}
  checkPrivacy(b,['text'],'boletín',issues);
  const origins=new Set([...declared.values()].filter(s=>s.kind==='oficial').map(s=>hostKey(new URL(registry.get(s.id).url).hostname)));
  for(const [i,cite] of b.sources.entries()){
    if(!cite || !isText(cite.title) || !isText(cite.source) || !publicUrl(cite.url) || !origins.has(hostKey(new URL(cite.url).hostname))) issues.push('referencia '+i+' del boletín · título u origen inválido');
    else if(!snapshotsByUrl.has(cite.url)) notes.push('Una referencia del boletín pertenece a una edición anterior del listado.');
  }
  if(b.audioUrl){
    if(!/^\/?media\/[a-zA-Z0-9_-]+\.(?:wav|mp3)$/.test(b.audioUrl) || !files.has(b.audioUrl.replace(/^\//,''))) issues.push('boletín · audio fuera de media/ o sin archivo público');
    if(!isText(b.voiceType)) issues.push('boletín · audio sin identificación de voz');
  }
}

async function readPublic(file,meta){
  const fh=await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try{
    const current=await fh.stat();
    if(!current.isFile() || current.nlink!==1 || current.dev!==meta.dev || current.ino!==meta.ino) throw Error('archivo especial, compartido o cambiado durante la verificación');
    return await fh.readFile();
  }finally{await fh.close();}
}

function checkHtml(text, relative, files, issues) {
  for(const m of text.matchAll(/\b(href|src|poster|action)\s*=\s*["']([^"']*)["']/gi)){
    const [kind,raw]=[m[1].toLowerCase(),m[2]];
    if(raw.startsWith('#'))continue;
    if(kind==='src' && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(raw)) continue;
    if(/^[a-z][\w+.-]*:|^\/\//i.test(raw)){
      if(!publicUrl(raw)) issues.push(relative+' · enlace externo con esquema u origen no permitido');
      continue;
    }
    try {
      const url=new URL(raw,'https://atlas.invalid/'+relative);
      const resource=decodeURIComponent(url.pathname).slice(1);
      if(url.origin!=='https://atlas.invalid' || /[\\\x00-\x1f]/.test(raw) || resource.split('/').some(p=>p.startsWith('.')) || !files.has(resource || 'index.html')) issues.push(relative+' · referencia local inválida o inexistente');
    }catch{issues.push(relative+' · referencia ilegible');}
  }
}

export async function verificarPublico(directory) {
  const root=path.resolve(directory), issues=[],notes=[],files=new Set(),pages=[];
  let panorama;
  const rootStat=await lstat(root);
  if(!rootStat.isDirectory() || rootStat.isSymbolicLink())return {issues:['La raíz pública debe ser un directorio real.'],notes,files:0};
  async function walk(parent){
    for(const name of await readdir(path.join(root,parent))){
      const relative=parent?parent+'/'+name:name, file=path.join(root,relative), display=label(relative);
      const meta=await lstat(file);
      if(meta.isSymbolicLink()){issues.push(display+' · enlace simbólico');continue;}
      if(relative==='.nojekyll'&&meta.isFile()&&meta.size===0&&meta.nlink===1){files.add(relative);continue;}
      if(name.startsWith('.') || blockedName.test(name) || name.includes('\\') || /[\x00-\x1f]/.test(name) || sensitiveText.some(rx=>rx.test(name))){issues.push(display+' · nombre reservado');continue;}
      if(meta.isDirectory()){await walk(relative);continue;}
      if(!meta.isFile() || meta.nlink!==1 || !extensions.has(path.extname(name).toLowerCase())){issues.push(display+' · tipo de archivo no público');continue;}
      const data=await readPublic(file,meta);
      files.add(relative);
      const raw=data.toString('latin1');
      if(sensitiveText.some(rx=>rx.test(raw))) issues.push(display+' · posible credencial o clave privada (valor omitido)');
      if(relative==='data/panorama.json'){
        try{panorama=JSON.parse(data.toString('utf8'));}catch{issues.push('panorama · JSON inválido');}
      }
      if(relative==='data/temperatura.json'){
        try{if(!isTemperatureSnapshot(JSON.parse(data.toString('utf8')))) issues.push('temperatura · serie semanal inválida');}
        catch{issues.push('temperatura · JSON inválido');}
      }
      if(/\.html$/i.test(name))pages.push([data.toString('utf8'),display]);
    }
  }
  await walk('');
  if(!files.has('index.html'))issues.push('Falta la portada pública.');
  for(const [html,name] of pages)checkHtml(html,name,files,issues);
  checkSnapshot(panorama,files,issues,notes);
  return {issues:[...new Set(issues)],notes:[...new Set(notes)],files:files.size};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const target=process.argv[2]??process.env.ATLAS_PUBLIC_DIR??fileURLToPath(new URL('../public/',import.meta.url));
  try{
    const {issues,notes,files}=await verificarPublico(target);
    for(const note of notes)console.warn('Aviso:',note);
    for(const issue of issues)console.error('Revisar:',issue);
    if(issues.length)process.exitCode=1;
    else console.log('Publicación verificada en '+files+' archivos.');
  }catch{console.error('No fue posible completar la verificación del directorio público.');process.exitCode=1;}
}
