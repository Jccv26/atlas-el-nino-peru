import {readWeatherIndex,readWeatherDetail,mergeWeatherRecords,weatherIndexUrl,weatherSourceId} from './avisos-meteorologicos-api.mjs';

const minute=60000,cacheKey='peru-al-dia.senamhi.meteo.v1';
const sourceItem=item=>item.sourceId===weatherSourceId;
const timestamp=value=>Date.parse(value || '');

function validateSample(raw) {
  const now=timestamp(raw?.checkedAt);
  if(!Number.isFinite(now))throw Error('Hora de lectura meteorológica inválida');
  const records=[],unverified=[];
  for(const notice of readWeatherIndex(raw.index,now)) {
    try {records.push(readWeatherDetail(raw.details?.[notice.id],notice,now));}
    catch {unverified.push(notice.key);}
  }
  if(!records.length)throw Error('Ninguna ficha meteorológica completa');
  return {checkedAt:raw.checkedAt,records,unverified};
}

// Both the server and visiting browsers read the public national index and the corresponding numbered details.
export async function fetchWeatherSample(request,now) {
  const signal=AbortSignal.timeout(15000);
  async function json(url) {
    const response=await request(url,{signal,mode:'cors',credentials:'omit',redirect:'error',cache:'no-cache'});
    if(!response.ok)throw Error('Servicio meteorológico sin respuesta');
    return response.json();
  }
  const raw={checkedAt:new Date(now).toISOString(),index:await json(weatherIndexUrl),details:{}};
  const notices=readWeatherIndex(raw.index,now);
  let next=0;
  async function worker() {
    while(next<notices.length) {
      const {id}=notices[next++];
      try {raw.details[id]=await json(weatherIndexUrl+'/'+id);}
      catch { /* Preserve the prior notice if only its detail is unreachable. */ }
    }
  }
  await Promise.all(Array.from({length:Math.min(3,notices.length)},worker));
  return {raw,sample:validateSample(raw)};
}

export function withMeteorologicalReading(edition,sample,now=Date.now()) {
  if(!edition||!sample)return edition;
  const official=edition.sources?.find(source=>source.id===weatherSourceId);
  const at=timestamp(sample.checkedAt);
  if(!Number.isFinite(at) || at>now || at<=(timestamp(official?.lastSuccessAt)||0) || now-at>24*60*minute)return edition;
  try {
    const current=sample.records.filter(item=>timestamp(item.validUntil)>=now);
    if(!current.length)return edition;
    const verified=new Set(current.map(item=>item.id));
    const items=mergeWeatherRecords(current,edition.items.filter(sourceItem),now,sample.unverified).map(item=>
      verified.has(item.id)?{...item,directMeteoCheckedAt:sample.checkedAt}:item);
    return {...edition,items:[...edition.items.filter(item=>!sourceItem(item)),...items],directMeteoCheckedAt:sample.checkedAt};
  } catch {return edition;}
}

export function meteorologicalReader({storage,request=globalThis.fetch,clock=Date.now}={}) {
  let sample=null,failed=false,pending=null,lastAttempt=-Infinity;
  try {
    const text=storage?.getItem(cacheKey);
    if(text && text.length<2_000_000) {
      const raw=JSON.parse(text),age=clock()-timestamp(raw?.checkedAt);
      if(age>=0 && age<24*60*minute)sample=validateSample(raw);
    }
  } catch {}
  async function read(edition) {
    const {raw,sample:latest}=await fetchWeatherSample(request,clock());
    mergeWeatherRecords(latest.records,edition.items.filter(sourceItem),timestamp(latest.checkedAt),latest.unverified);
    if(sample) {
      // A previously verified browser-only issue can be more recent than the
      // edition on Pages. Keep that sample until its missing detail is available.
      if(sample.records.some(record=>latest.unverified.includes(record.id)))throw Error('Se conserva la última lectura completa');
      mergeWeatherRecords(latest.records,sample.records,timestamp(latest.checkedAt),latest.unverified);
    }
    sample=latest;failed=Boolean(latest.unverified.length);
    try {
      const json=JSON.stringify(raw);
      if(json.length<2_000_000)storage?.setItem(cacheKey,json);
    } catch {}
  }
  return {
    get sample(){return sample;},get failed(){return failed;},get pending(){return pending;},
    refresh(edition) {
      if(pending || !edition)return pending;
      const now=clock(),source=edition.sources?.find(source=>source.id===weatherSourceId);
      if(source?.status==='ok' && now-timestamp(source.lastSuccessAt)<15*minute && now-timestamp(edition.updatedAt)<30*minute)return null;
      if(now-lastAttempt<5*minute || !failed && sample && now-timestamp(sample.checkedAt)<15*minute)return null;
      lastAttempt=now;
      pending=read(edition).catch(()=>{failed=true;}).finally(()=>{pending=null;});
      return pending;
    }
  };
}
