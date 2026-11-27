const endpoint = 'https://servicios.senamhi.gob.pe/api/hydrology/warnings';
const site = 'https://www.senamhi.gob.pe/';
export const hydrologyIndexUrl = endpoint + '?status=ACTIVE';
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const departments = new Map('Amazonas|Áncash|Apurímac|Arequipa|Ayacucho|Cajamarca|Callao|Cusco|Huancavelica|Huánuco|Ica|Junín|La Libertad|Lambayeque|Lima|Loreto|Madre de Dios|Moquegua|Pasco|Piura|Puno|San Martín|Tacna|Tumbes|Ucayali'.split('|').map(name=>[fold(name),name]));
const thresholds = new Map([[2,['AMARILLO','#ffff00']],[3,['NARANJA','#ffa500']],[4,['ROJO','#ff0000']]]);
const months = 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ');
const sourceId='senamhi-rios', sourceName='SENAMHI · Ríos';
export {peruvianDate,threshold,placeName};
const integer = (v,max) => Number.isSafeInteger(v) && v>0 && v<=max;
const stationCode = value => typeof value==='string' && /^[A-Za-z0-9]{1,18}$/.test(value);
function placeName(value) {
  if(typeof value!=='string' || value.length>120 || !/^[\p{L}\d][\p{L}\d .’'()-]*$/u.test(value) || /\d{6}/.test(value)) return '';
  return value.trim().toLocaleLowerCase('es').split(/\s+/).map((word,i)=>
    word==='enapu'?'ENAPU':i && ['de','del','la','las','los'].includes(word)?word:word[0].toLocaleUpperCase('es')+word.slice(1)).join(' ');
}
function threshold(level) {
  const found=thresholds.get(level?.code);
  if (!found || level.colorBackground?.toLowerCase()!==found[1]) throw Error('Umbral de Servicios SENAMHI sin verificar');
  return found[0];
}
function peruvianDate(value) {
  const input=fold(value).replace(/^(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo),\s*/,'');
  let parts=input.match(/^(\d{2})\/(\d{2})\/(20\d{2}) (\d{2}):([0-5]\d) horas$/);
  if(!parts) {
    const long=input.match(/^(\d{1,2}) de ([a-z]+) de (20\d{2}) a las (\d{2}):([0-5]\d) horas$/);
    if(!long) return;
    parts=[null,long[1].padStart(2,'0'),String(months.indexOf(long[2].replace('setiembre','septiembre'))+1).padStart(2,'0'),...long.slice(3)];
  }
  const [,day,month,year,hour,minute]=parts, date=year+'-'+month+'-'+day;
  const time=Date.parse(date+'T'+hour+':'+minute+':00-05:00');
  if(Number(hour)>23 || !Number.isFinite(time) || new Date(time-5*3600000).toISOString().slice(0,10)!==date)return;
  return new Date(time).toISOString();
}
function sourceData(payload) {
  const body=typeof payload==='string'?JSON.parse(payload):payload;
  if(body?.status!==true || !body.data || (body.validations && (!Array.isArray(body.validations) || body.validations.length)))
    throw Error('Respuesta de Servicios SENAMHI sin verificar');
  return body.data;
}
function identity(record) {
  try {
    const url=new URL(record.url), id=url.searchParams.get('ca'), station=url.searchParams.get('ce');
    if(url.origin+url.pathname!==site || url.username || url.password || url.hash || url.searchParams.size!==3 ||
      url.searchParams.get('p')!=='avisos-detalle-hidrologicos' || !/^[1-9]\d{0,9}$/.test(id) || !stationCode(station)) return;
    return {id,station};
  } catch {}
}
export function hydrologyDetailUrl(record) {
  const ref=identity(record);
  if(!ref)throw Error('Referencia de aviso hidrológico no válida');
  return endpoint+'/'+ref.id+'?'+new URLSearchParams({stationCode:ref.station});
}
function regionFor(department,province) {
  if(department!=='Lima')return department;
  return !province?'':fold(province)==='lima'?'Lima Metropolitana':'Lima';
}
function indexRecord(row,now) {
  const department=departments.get(fold(row?.department)), name=placeName(row?.stationName);
  const title=row?.title;
  const start=peruvianDate(row?.startDate),end=peruvianDate(row?.endDate),issued=peruvianDate(row?.emissionDate);
  if(!integer(row?.id,9999999999) || !integer(row.number,999999) || !stationCode(row.stationCode) ||
    !department || !name || typeof title!=='string' || title.length>320 || /[<>\p{Cc}\p{Cf}@]/u.test(title) || /\d{6}/.test(title) ||
    !title.match(/\b(?:nivel|caudal)\b/i) || !['vigente','emitido'].includes(fold(row.status)) ||
    !start || !end || !issued || start>=end || issued>end || Date.parse(issued)>+now+60000) throw Error('Aviso activo de Servicios SENAMHI incompleto');
  const year=new Date(Date.parse(start)-5*3600000).toISOString().slice(0,4), region=regionFor(department);
  const url=site+'?'+new URLSearchParams({p:'avisos-detalle-hidrologicos',ca:row.id,ce:row.stationCode});
  const lon=row.longitude,lat=row.latitude;
  const coordinates=Number.isFinite(lon) && Number.isFinite(lat) && lon>=-82 && lon<=-68 && lat>=-19 && lat<=0 ? [lon,lat]:undefined;
  return {id:sourceId+':'+year+'-'+row.number,sourceId,source:sourceName,sourceName,kind:'oficial',category:'Ríos',
    noticeNumber:String(row.number),noticeYear:year,title:title.trim(),url,level:threshold(row.level),stationName:name,locality:name,
    stationDepartment:department,region,regions:region?[region]:[],regionOrigin:'servicios-senamhi',
    ...(coordinates && {coordinates}),publishedAt:issued,validFrom:start,validUntil:end,datePrecision:'minute',sourceStatus:fold(row.status)};
}
export function readHydrologyIndex(payload,now=new Date()) {
  const data=sourceData(payload);
  if(!Number.isFinite(+now) || !Array.isArray(data) || data.length>1200)throw Error('Índice de Servicios SENAMHI inválido');
  const records=data.map(row=>indexRecord(row,now));
  if(new Set(records.map(r=>r.id)).size!==records.length || new Set(data.map(r=>r.id)).size!==data.length)
    throw Error('Identidad duplicada en el índice de Servicios SENAMHI');
  return records;
}
export function readHydrologyDetail(payload,record,now=new Date()) {
  const d=sourceData(payload).hydrologicalWarning, ref=identity(record);
  if(!ref || !d || !Number.isFinite(+now) || String(d.id)!==ref.id || String(d.number)!==record.noticeNumber ||
    fold(d.title)!==fold(record.title) || fold(d.station)!==fold(record.stationName) || fold(d.department)!==fold(record.stationDepartment) ||
    threshold(d.level)!==record.level || peruvianDate(d.emissionDate)!==record.publishedAt ||
    peruvianDate(d.startDate)!==record.validFrom || peruvianDate(d.endDate)!==record.validUntil)
    throw Error('Detalle incompatible con el índice de Servicios SENAMHI');
  const province=placeName(d.province),district=placeName(d.district);
  const region=regionFor(record.stationDepartment,province);
  const result={...record,region,regions:region?[region]:[],...(province && {stationProvince:province}),...(district && province && {stationDistrict:district})};
  // lastDate/lastHour identifies the observation. Start and emission have different meanings.
  const at=peruvianDate(d.lastDate+' '+d.lastHour);
  const unit=new Map([['m3/s','m³/s'],['m³/s','m³/s'],['m.s.n.m','m s. n. m.'],['m.s.n.m.','m s. n. m.'],['m','m']]).get(fold(d.unit));
  const kind=unit==='m³/s'?'caudal':'nivel';
  const value=/^-?\d{1,9}([.,]\d{1,6})?$/.test(String(d.lastHourValue)) ? Number(String(d.lastHourValue).replace(',','.')) : NaN;
  if(at && Date.parse(at)<=+now && at<=record.publishedAt && unit && record.title.toLowerCase().includes(kind) && Number.isFinite(value) && (kind!=='caudal' || value>=0)) {
    result.observedAt=at;
    result.riverMeasurement={kind,value,unit};
    result.summary='SENAMHI registró un '+kind+' de '+String(value).replace('.',',')+' '+unit+' en la estación '+record.stationName+'. El aviso indica umbral '+record.level.toLocaleLowerCase('es')+'.';
  }
  return result;
}
function warningTime(value, end=false) {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+(end?'T23:59:59.999-05:00':'T00:00:00-05:00'):value);
}
function stillCurrent(item,now) {
  if(item.supersededBy || item.withdrawnAt || item.invalidValidity)return false;
  if(!item.validUntil && item.phisisListedAt) {
    const age=+now-Date.parse(item.phisisListedAt);
    return age>=0 && age<=2*3600000;
  }
  return warningTime(item.validFrom)<=+now && warningTime(item.validUntil,true)>+now;
}
const order = row => Number(row?.id?.match(/^senamhi-rios:(20\d\d)-/)?.[1] || 0)*1000000+Number(row?.noticeNumber || 0);
function latestByStation(records) {
  const latest=new Map();
  for(const row of records) {
    const code=identity(row)?.station;
    if(code && order(row)>order(latest.get(code)))latest.set(code,row);
  }
  return latest;
}
export function acceptsHydrologyIndex(records,previous,now) {
  const known=latestByStation(previous.filter(r=>r.sourceId===sourceId && stillCurrent(r,now)));
  if(!records.length)return !known.size;
  for(const [station,fresh] of latestByStation(records)) {
    const prior=known.get(station);
    if(prior && (order(prior)>order(fresh) || Date.parse(prior.publishedAt)>Date.parse(fresh.publishedAt)))return false;
  }
  return true;
}
function sameEdition(old,row) {
  return old?.id===row.id && old.url===row.url && old.noticeNumber===row.noticeNumber &&
    (!old.stationName || fold(old.stationName)===fold(row.stationName)) && fold(old.title)===fold(row.title) &&
    (!old.regions?.length || old.regions.some(region=>fold(region==='Lima Metropolitana'?'Lima':region)===fold(row.stationDepartment))) &&
    (!old.stationProvince || !row.stationProvince || fold(old.stationProvince)===fold(row.stationProvince)) &&
    (!old.level || old.level===row.level) && (!old.publishedAt || Date.parse(old.publishedAt)===Date.parse(row.publishedAt));
}
export function mergeHydrologyIndex(records,previousItems=[],now=new Date()) {
  const previous=previousItems.filter(r=>r.sourceId===sourceId);
  const oldById=new Map(previous.map(row=>[row.id,row]));
  const knownByStation=latestByStation([...previous,...records].filter(row=>stillCurrent(row,now)));
  const present=new Set(records.map(r=>r.id));
  const regressed=!acceptsHydrologyIndex(records,previous,now);
  const result=[];
  for(const row of [...records,...previous.filter(row=>!present.has(row.id))]) {
    const old=oldById.get(row.id);
    let current={...row};
    if(present.has(row.id) && sameEdition(old,row)) {
      current={...old,...row};
      if(old.region && !row.region && old.stationProvince) {
        current.region=old.region;current.regions=old.regions;
      }
      if(row.riverMeasurement && old.summary && Date.parse(old.observedAt)===Date.parse(row.observedAt) &&
          old.riverMeasurement?.value===row.riverMeasurement.value && old.riverMeasurement?.unit===row.riverMeasurement.unit)
        current.summary=old.summary;
    }
    if(old?.url===row.url && (old.withdrawnAt || old.supersededBy)) {
      for(const field of ['withdrawnAt','supersededBy','supersededUrl','sourceStatus']) if(old[field]!=null)current[field]=old[field];
    }
    const next=knownByStation.get(identity(row)?.station);
    if(!current.supersededBy && next && order(next)>order(row) && !(present.has(row.id) && present.has(next.id)) &&
      warningTime(next.validFrom)<warningTime(row.validUntil,true)) {
      current.supersededBy=next.noticeNumber;current.supersededUrl=next.url;current.sourceStatus='actualizado';
    } else if(!present.has(row.id) && records.length && !regressed && stillCurrent(current,now) &&
      ['vigente','emitido'].includes(fold(current.sourceStatus))) {
      current.withdrawnAt=now.toISOString();current.sourceStatus='fuera del listado de Servicios SENAMHI';
    }
    result.push(current);
  }
  return result;
}
