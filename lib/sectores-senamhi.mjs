import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const origin = 'https://www.senamhi.gob.pe';
const types = {
  'senamhi-lluvias': {file:'sectores-lluvias.json', path:/^\/load\/file\/02249SENA-\d+\.zip$/},
  'senamhi-quebradas': {file:'sectores-quebradas.json', path:/^\/load\/aq-aviso-shape\/aq_\d{4}-\d\d-\d\d\.zip$/},
};
function officialZip(value, kind, date) {
  try {
    const url = new URL(value, origin);
    if (url.origin!==origin || url.username || url.password || url.search || url.hash || !types[kind]?.path.test(url.pathname)) return null;
    if (kind==='senamhi-quebradas' && !url.pathname.endsWith('/aq_'+date+'.zip')) return null;
    return url.href;
  } catch { return null; }
}
// Both archives carry a table binding the edition number, date and download in one row.
export function archivoSectores(html, kind, date, number) {
  for (const [,row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].trim());
    if (cells[0]!==date || cells[1]!==String(number)) continue;
    const link = cells[2]?.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (link) return officialZip(link,kind,date);
  }
  return null;
}
function parseArchive(bytes,date) {
  return new Promise((resolve,reject)=>{
    const script = fileURLToPath(new URL('../scripts/leer-sectores.py',import.meta.url));
    const child = execFile('python3',[script,date],{timeout:35000,maxBuffer:8_000_000},(error,stdout)=>{
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.on('error',reject);
    child.stdin.end(bytes);
  });
}
async function fetchArchive(url) {
  const resp = await fetch(url,{redirect:'error',signal:AbortSignal.timeout(25000)});
  if (!resp.ok || !resp.body || Number(resp.headers.get('content-length'))>16_000_000) {
    await resp.body?.cancel(); throw new Error('Archivo sectorial inaccesible');
  }
  const chunks = []; let size = 0;
  for await (const chunk of resp.body) {
    size+=chunk.byteLength;
    if (size>16_000_000) throw new Error('Archivo sectorial excesivo');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function pathsValid(features) {
  return Array.isArray(features) && features.length>0 && features.length<=3 && features.every(f=>
    ['AMARILLO','NARANJA','ROJO'].includes(f.level) && typeof f.d==='string' && /^M[0-9.,MLZ]+Z$/.test(f.d));
}
const fingerprint = features => createHash('sha256').update(JSON.stringify(features)).digest('hex').slice(0,16);
export async function actualizarSectores(items, dataDir, now = new Date()) {
  const time = new Date(now).getTime();
  await Promise.all(Object.entries(types).map(async ([kind,{file}])=>{
    const records = items.filter(r=>r.sourceId===kind);
    for (const r of records) delete r.sectorMap;
    const current = records.filter(r=>!r.withdrawnAt && !r.supersededBy && !r.invalidValidity &&
      Date.parse(r.validFrom)<=time && time<Date.parse(r.validUntil)).sort((a,b)=>b.validFrom.localeCompare(a.validFrom));
    const record = current[0];
    if (!record || !/^\d+$/.test(record.noticeNumber)) return;
    const date = new Date(Date.parse(record.validFrom)-5*3600000).toISOString().slice(0,10);
    const path = join(dataDir,file), tmp = path+'.'+randomUUID()+'.tmp';
    const expectedUrl = officialZip(record.shapeArchiveUrl,kind,date);
    const sourceOf = data => officialZip(data.sourceUrl,kind,date);
    const bind = data => { record.sectorMap={url:'data/'+file,sourceUrl:data.sourceUrl,date,noticeNumber:record.noticeNumber,digest:data.digest || fingerprint(data.features)}; };
    try {
      const previous = await readFile(path,'utf8').then(JSON.parse).catch(()=>null);
      if (previous && previous.sourceId===kind && previous.date===date && previous.noticeNumber===record.noticeNumber &&
        previous.validFrom===record.validFrom && previous.validUntil===record.validUntil && sourceOf(previous) &&
        (!expectedUrl || previous.sourceUrl===expectedUrl) && pathsValid(previous.features)) {
        const digest=fingerprint(previous.features);
        if (previous.digest && previous.digest!==digest) throw Error("Geometría de archivo inconsistente");
        if (!previous.digest) {
          previous.digest=digest;
          await writeFile(tmp,JSON.stringify(previous));await rename(tmp,path);
        }
        bind(previous);
        const age=time-Date.parse(previous.checkedAt);
        if (age>=0 && age<3600000) return;
      }
      if (!expectedUrl) return;
      const features = await parseArchive(await fetchArchive(expectedUrl),date);
      if (!pathsValid(features)) return;
      const data = {sourceId:kind,date,noticeNumber:record.noticeNumber,validFrom:record.validFrom,validUntil:record.validUntil,sourceUrl:expectedUrl,checkedAt:new Date(time).toISOString(),digest:fingerprint(features),features};
      await mkdir(dataDir,{recursive:true});
      await writeFile(tmp,JSON.stringify(data)); await rename(tmp,path); bind(data);
    } catch { /* An unavailable ZIP cannot invalidate the official notice. */ }
    finally { await rm(tmp,{force:true}).catch(()=>{}); }
  }));
}
