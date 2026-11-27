import {peruvianDate,placeName,threshold} from './avisos-hidrologicos-api.mjs';
import {normalizePlace} from './territorios.mjs';

export const weatherIndexUrl='https://servicios.senamhi.gob.pe/api/risks/weather-warnings';
export const weatherSourceId='senamhi-meteo';
const sourceName='SENAMHI · Meteorología';
const site='https://www.senamhi.gob.pe/';
const dayMs=86400000;
const dayInLima=value=>new Date(Date.parse(value)-5*3600000).toISOString().slice(0,10);
const departments='Amazonas|Áncash|Apurímac|Arequipa|Ayacucho|Cajamarca|Callao|Cusco|Huancavelica|Huánuco|Ica|Junín|La Libertad|Lambayeque|Lima|Loreto|Madre de Dios|Moquegua|Pasco|Piura|Puno|San Martín|Tacna|Tumbes|Ucayali'.split('|');
// Spellings in the meteorological API differ from the local UBIGEO catalogue.
const provinceAliases=new Map([['0207:carlos f. fitzcarrald','Carlos Fermín Fitzcarrald'],['1103:nazca','Nasca']]);

function requireValue(test) {
  if(!test)throw Error('Aviso meteorológico de SENAMHI incompleto o contradictorio');
}
const safeInteger=(value,max)=>Number.isInteger(value)&&value>0&&value<=max;
const plain=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
function dataOf(payload) {
  requireValue(payload?.status===true && (!payload.validations || Array.isArray(payload.validations)&&!payload.validations.length));
  return payload.data;
}

export function readWeatherIndex(payload,now) {
  const rows=dataOf(payload);
  requireValue(Array.isArray(rows) && rows.length>0 && rows.length<=100);
  const seen=new Set(),ids=new Set(),active=[];
  for(const row of rows) {
    const validFrom=peruvianDate(row?.startDate),validUntil=peruvianDate(row?.endDate);
    requireValue(safeInteger(row?.number,99999) && safeInteger(row.id,999999999) && plain(row.title,400));
    requireValue(validFrom && validUntil && validFrom<validUntil);
    const year=dayInLima(validFrom).slice(0,4), key=weatherSourceId+':'+year+'-'+row.number;
    requireValue(!seen.has(key) && !ids.has(row.id));seen.add(key);ids.add(row.id);
    // The service can keep the preceding edition in its list after local midnight.
    if(Date.parse(validUntil)<now)continue;
    requireValue(['vigente','proximo','emitido'].includes(normalizePlace(row.status)));
    active.push({key,id:row.id,number:row.number,year,title:row.title.trim(),validFrom,validUntil,level:threshold(row.level)});
  }
  requireValue(active.length);
  return active;
}

function dailyCoverage(map,notice,index) {
  const start=peruvianDate(map?.date+' a las '+map?.startHour),end=peruvianDate(map?.date+' a las '+map?.endHour);
  requireValue(start && end && start<=end && start>=notice.validFrom && end<=notice.validUntil);
  const date=dayInLima(start), year=notice.year, number=index+1;
  requireValue(map.mapNumber===number && map.wmsParameters?.viewparams==='qry:'+notice.number+'_'+number+'_'+year);
  threshold(map.level);
  requireValue(Array.isArray(map.departments) && map.departments.length && map.departments.length<=departments.length);
  const provincesByRegion={},seen=new Set();
  for(const department of map.departments) {
    const code=department?.id;
    const region=departments[Number(code)-1];
    requireValue(typeof code==='string' && /^\d\d$/.test(code) && region && normalizePlace(department.name)===normalizePlace(region) && !seen.has(code));
    seen.add(code);
    requireValue(Array.isArray(department.provinces) && department.provinces.length && department.provinces.length<=30);
    const provinceIds=new Set();
    for(const province of department.provinces) {
      const name=placeName(province?.name);
      requireValue(name && typeof province.id==='string' && /^\d\d$/.test(province.id) && province.id!=='00' && !provinceIds.has(province.id));
      provinceIds.add(province.id);
      if(code==='15')requireValue((province.id==='01')===(normalizePlace(name)==='lima'));
      const area=code==='15' && province.id==='01'?'Lima Metropolitana':region;
      const canonical=provinceAliases.get(code+province.id+':'+normalizePlace(name)) || name;
      (provincesByRegion[area]??=[]).push(canonical);
    }
  }
  const url=site+'mapas/mapa-avisos-meteorologicos/index.php?'+new URLSearchParams({av:String(notice.number),nl:String(map.level.code),mp:String(number),fc:year});
  return {date,regions:Object.keys(provincesByRegion),provincesByRegion,url};
}

export function readWeatherDetail(payload,notice,now) {
  const detail=dataOf(payload)?.weatherWarning;
  requireValue(detail?.id===notice.id && detail.number===notice.number && normalizePlace(detail.title)===normalizePlace(notice.title));
  requireValue(threshold(detail.level)===notice.level && peruvianDate(detail.startDate)===notice.validFrom && peruvianDate(detail.endDate)===notice.validUntil);
  const publishedAt=peruvianDate(detail.publicationDate);
  requireValue(publishedAt && Date.parse(publishedAt)<=now && publishedAt<=notice.validUntil && plain(detail.description,5000));
  const first=dayInLima(notice.validFrom),last=dayInLima(notice.validUntil);
  const count=1+(Date.parse(last)-Date.parse(first))/dayMs;
  requireValue(count>0 && count<=31 && Array.isArray(detail.maps) && detail.maps.length===count);
  const maps=[...detail.maps].sort((a,b)=>a.mapNumber-b.mapNumber);
  const coverageDays=maps.map((map,i)=>dailyCoverage(map,notice,i));
  requireValue(coverageDays.every((day,i)=>Date.parse(day.date)===Date.parse(first)+i*dayMs));
  const regions=[...new Set(coverageDays.flatMap(day=>day.regions))];
  const url=site+'?'+new URLSearchParams({p:'aviso-meteorologico-vigente',a:notice.year,b:String(notice.id),c:'00',d:'SENA'});
  const category=/lluvia|precipitacion|granizada|llovizna|tormenta/.test(normalizePlace(notice.title))?'Lluvias':'Meteorología';
  // Each map has a national maximum. Its department and province lists are ungraded.
  return {id:notice.key,sourceId:weatherSourceId,source:sourceName,kind:'oficial',sourceName,title:notice.title,url,
    publishedAt,category,regions,region:regions.join(', '),validFrom:notice.validFrom,validUntil:notice.validUntil,datePrecision:'minute',
    sourceStatus:Date.parse(notice.validFrom)>now?'emitido':'vigente',level:notice.level,noticeNumber:String(notice.number),
    summary:detail.description.trim(),regionOrigin:'mapa-senamhi',coverageUrls:coverageDays.map(day=>day.url),coverageDays,coverageDaysComplete:true};
}

function footprint(day) {
  return JSON.stringify(day?.regions?.map(region=>[region,(day.provincesByRegion?.[region]||[]).map(normalizePlace).sort()]).sort());
}

// Reject an older or partial active index instead of silently losing a known current warning.
export function mergeWeatherRecords(records,previous,now,unverified=[]) {
  const found=new Map(records.map(item=>[item.id,item]));
  const retained=new Set(unverified);
  for(const old of previous) {
    const end=/^\d{4}-\d\d-\d\d$/.test(old.validUntil)?old.validUntil+'T23:59:59-05:00':old.validUntil;
    if(old.withdrawnAt || old.supersededBy || !(Date.parse(end)>=now) || retained.has(old.id))continue;
    const updated=found.get(old.id);
    requireValue(updated && (!old.publishedAt || Date.parse(updated.publishedAt)>=Date.parse(old.publishedAt)));
  }
  const former=new Map(previous.map(item=>[item.id,item]));
  const result=records.map(record=>{
    const old=former.get(record.id);
    if(!old)return record;
    requireValue(!old.withdrawnAt && !old.supersededBy && new URL(old.url).searchParams.get('b')===new URL(record.url).searchParams.get('b'));
    // Retain verified, finer territorial details only when the issued geography still matches.
    const same=record.level===old.level && record.validFrom===old.validFrom && record.validUntil===old.validUntil &&
      old.coverageDays?.length===record.coverageDays.length && record.coverageDays.every((day,i)=>day.date===old.coverageDays[i].date && day.url===old.coverageDays[i].url && footprint(day)===footprint(old.coverageDays[i]));
    const merged=same ? {...old,...record,coverageDays:old.coverageDays,coverageUrls:[...new Set([...record.coverageUrls,...(old.coverageUrls||[])])]} : {...record};
    return merged;
  });
  return result.concat(previous.filter(item=>!found.has(item.id)));
}
