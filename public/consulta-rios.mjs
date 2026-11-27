import {hydrologyIndexUrl,hydrologyDetailUrl,readHydrologyIndex,readHydrologyDetail,mergeHydrologyIndex,acceptsHydrologyIndex} from "./avisos-hidrologicos-api.mjs";

const minute=60000;
const cacheKey="peru-al-dia.senamhi.rios.v1";
const sameSource=item=>item.sourceId==="senamhi-rios";
const stamp=value=>Date.parse(value || "");
const week=7*24*60*minute;

export function needsRiverReading(edition,now=Date.now()) {
  if(!edition)return false;
  const source=edition.sources?.find(s=>s.id==="senamhi-rios");
  return now-stamp(edition.updatedAt)>=30*minute || !source || source.status!=="ok" ||
    !Number.isFinite(stamp(source.lastSuccessAt)) || now-stamp(source.lastSuccessAt)>=15*minute;
}
function decoded(raw) {
  const date=new Date(raw.checkedAt);
  const records=readHydrologyIndex(raw.index,date).map(record=>{
    if(!Object.hasOwn(raw.details || {},record.id))return record;
    try{return readHydrologyDetail(raw.details[record.id],record,date);}catch{return record;}
  });
  // A cached withdrawal can only veto a later contradictory active index.
  const retired=(raw.retired || []).filter(entry=>typeof entry.id==="string" && /^senamhi-rios:20\d{2}-\d{1,6}$/.test(entry.id) &&
    Number.isFinite(entry.until) && entry.until>+date && entry.until<=+date+week);
  return {checkedAt:date.toISOString(),records,retired};
}

// Validate stored public source payloads again with the network parser.
export function riverReader({request=globalThis.fetch,clock=Date.now,storage}={}) {
  let sample=null,pending=null,lastAttempt=-Infinity,failed=false,priorDetails={};
  try {
    const value=storage?.getItem(cacheKey);
    if(value && value.length<2_000_000) {
      const raw=JSON.parse(value),age=clock()-stamp(raw.checkedAt);
      if(age>=0 && age<=week){sample=decoded(raw);priorDetails=raw.details || {};}
    }
  } catch {}
  async function read(edition) {
    const limit=AbortSignal.timeout(12000);
    async function json(url) {
      const response=await request(url,{mode:"cors",credentials:"omit",cache:"no-cache",redirect:"error",signal:limit});
      if(!response.ok)throw Error("Respuesta de SENAMHI no disponible");
      return response.json();
    }
    const index=await json(hydrologyIndexUrl),now=clock();
    const raw={checkedAt:new Date(now).toISOString(),index,details:{}};
    const records=readHydrologyIndex(index,new Date(now));
    const central=edition.items.filter(sameSource);
    const retired=new Map((sample?.retired || []).filter(r=>r.until>now).map(r=>[r.id,r.until]));
    if(records.some(row=>retired.has(row.id)) || !acceptsHydrologyIndex(records,[...central,...(sample?.records || [])],now))throw Error("Listado sin confirmar");
    const previous=sample ? mergeHydrologyIndex(sample.records,central,new Date(sample.checkedAt)) : central;
    const merged=mergeHydrologyIndex(records,previous,new Date(now));
    for(const row of merged) {
      const until=stamp(row.validUntil);
      if((row.withdrawnAt || row.supersededBy) && until>now)retired.set(row.id,Math.min(until,now+week));
    }
    raw.retired=[...retired].map(([id,until])=>({id,until}));
    const byId=new Map(merged.map(r=>[r.id,r]));
    for(const record of records) {
      if(!Object.hasOwn(priorDetails,record.id))continue;
      try {
        readHydrologyDetail(priorDetails[record.id],record,new Date(now));
        raw.details[record.id]=priorDetails[record.id];
      } catch {}
    }
    const missing=records.filter(r=>{
      const full=byId.get(r.id);
      return !Object.hasOwn(raw.details,r.id) && full && !full.supersededBy && !full.withdrawnAt && (!full.riverMeasurement || !full.observedAt || !full.stationDistrict);
    }).sort((a,b)=>stamp(b.publishedAt)-stamp(a.publishedAt));
    let cursor=0;
    async function details() {
      while(cursor<missing.length && !limit.aborted) {
        const record=missing[cursor++];
        try {
          const payload=await json(hydrologyDetailUrl(record));
          readHydrologyDetail(payload,record,new Date(now));
          raw.details[record.id]={status:true,data:{hydrologicalWarning:payload.data.hydrologicalWarning}};
        } catch {}
      }
    }
    await Promise.all(Array.from({length:Math.min(3,missing.length)},details));
    const accepted=decoded(raw);
    // Reuse verified details of an unchanged notice that arrived in an earlier response.
    const listed=new Set(records.map(r=>r.id));
    accepted.records=mergeHydrologyIndex(accepted.records,previous,new Date(accepted.checkedAt))
      .filter(r=>listed.has(r.id) && !r.withdrawnAt && !r.supersededBy);
    sample=accepted;priorDetails=raw.details;
    try {
      const serialized=JSON.stringify(raw);
      if(serialized.length<2_000_000)storage?.setItem(cacheKey,serialized);
    } catch {}
    failed=false;
  }
  return {
    get sample(){return sample;},get failed(){return failed;}, get pending(){return pending;},
    refresh(edition) {
      if(pending || !needsRiverReading(edition,clock()))return pending;
      if(clock()-lastAttempt<5*minute || sample && !failed && clock()-stamp(sample.checkedAt)<15*minute)return null;
      lastAttempt=clock();
      pending=read(edition).catch(()=>{failed=true;}).finally(()=>{pending=null;});
      return pending;
    },
  };
}

export function withRiverReading(edition,sample,now=Date.now()) {
  if(!edition || !sample)return edition;
  const source=edition.sources.find(s=>s.id==="senamhi-rios");
  const readAt=stamp(sample.checkedAt);
  if(!(readAt<=now && readAt>(stamp(source?.lastSuccessAt)||0)) || now-readAt>week)return edition;
  const baseline=edition.items.filter(sameSource);
  if(!acceptsHydrologyIndex(sample.records,baseline,now))return edition;
  const activeIds=new Set(sample.records.map(r=>r.id));
  const rivers=mergeHydrologyIndex(sample.records,baseline,new Date(readAt)).map(r=>
    activeIds.has(r.id) && !r.withdrawnAt && !r.supersededBy ? {...r,directRiverCheckedAt:sample.checkedAt}:r);
  return {...edition,items:[...rivers,...edition.items.filter(i=>!sameSource(i))],
    directRiverCheckedAt:sample.checkedAt};
}
