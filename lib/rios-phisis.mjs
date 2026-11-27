// This is the WFS layer used by SENAMHI's public hydrological-warning viewer.
// Its features are numbered warnings. Other PHISIS layers contain measurements.
const endpoint = 'https://idesep.senamhi.gob.pe/geoserver/g_dbphisis/ows';
const query = {
  service: 'WFS', version: '1.0.0', request: 'GetFeature',
  typeName: 'g_dbphisis:aviso_hidro_pub', outputFormat: 'application/json',
};
export const phisisRiverIndex = endpoint + '?' + new URLSearchParams(query);
const site = 'https://www.senamhi.gob.pe/';
const levels = ['AMARILLO','NARANJA','ROJO'];
const text = (v, max = 140) => typeof v === 'string' && v.length <= max && !/[<>\u0000-\u001f]/.test(v) ? v.trim() : '';
const fold = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function short(value) {
  return value.toLocaleLowerCase('es').split(/\s+/).map((word,i)=>{
    if (word==='enapu') return 'ENAPU';
    return i && ['de','del','la','las','los'].includes(word) ? word : word.charAt(0).toLocaleUpperCase('es')+word.slice(1);
  }).join(' ');
}
const departments = 'Amazonas|Áncash|Apurímac|Arequipa|Ayacucho|Cajamarca|Callao|Cusco|Huancavelica|Huánuco|Ica|Junín|La Libertad|Lambayeque|Lima|Loreto|Madre de Dios|Moquegua|Pasco|Piura|Puno|San Martín|Tacna|Tumbes|Ucayali'.split('|');
const canonical = new Map(departments.map(name => [fold(name),name]));

export function isPhisisRiverEvidence(value) {
  try {
    const url = new URL(value);
    if (url.origin+url.pathname !== endpoint || url.username || url.password || url.hash) return false;
    const filter = url.searchParams.get('CQL_FILTER');
    return /^id_aviso=[1-9]\d{0,9}$/.test(filter ?? '') &&
      [...url.searchParams].length === Object.keys(query).length+1 &&
      Object.entries(query).every(([k,v]) => url.searchParams.get(k) === v);
  } catch { return false; }
}

function featureRecord(feature, now) {
  const p = feature?.properties;
  const stationCode = feature?.id?.match(/^aviso_hidro_pub\.([0-9a-z]{1,18})$/i)?.[1];
  const recordNumber = String(p?.num_aviso ?? '');
  const recordId = String(p?.id_aviso ?? '');
  const title = text(p?.titulo,320), name = text(p?.nom_estacion);
  const province = text(p?.nom_provincia), district = text(p?.nom_distrito);
  const department = canonical.get(fold(p?.nom_departamento));
  const time = Date.parse(p?.fecha_hora), level = text(p?.color_text);
  if (!stationCode || !/^[1-9]\d{0,5}$/.test(recordNumber) || !/^[1-9]\d{0,9}$/.test(recordId) ||
      !department || !title || !name || !levels.includes(level) || !Number.isFinite(time) || time>+now+600000)
    throw Error('Registro PHISIS incompleto');
  const year = new Date(time - 5*3600000).getUTCFullYear();
  const place = department==='Lima' && fold(province)==='lima' ? 'Lima Metropolitana' : department;
  const officialUrl = site+'?'+new URLSearchParams({p:'avisos-detalle-hidrologicos',ca:recordId,ce:stationCode});
  // The stable detail URL uses the alert ID and station code. Filter WFS
  // evidence by the alert ID because a station may issue a newer warning.
  return {
    id:'senamhi-rios:'+year+'-'+recordNumber, sourceId:'senamhi-rios', source:'SENAMHI · Ríos',
    title,url:officialUrl,category:'Ríos',level,noticeNumber:recordNumber,noticeYear:String(year),
    regions:[place],region:place,regionOrigin:'estacion-phisis',locality:short(name),
    stationName:short(name), ...(province && {stationProvince:short(province)}), ...(district && {stationDistrict:short(district)}),
    observedAt:new Date(time).toISOString(),phisisListedAt:now.toISOString(),sourceStatus:'vigente',
    coverageUrls:[phisisRiverIndex+'&'+new URLSearchParams({CQL_FILTER:'id_aviso='+recordId})],
    summary:'El visor PHISIS de SENAMHI identifica la estación '+short(name)+' en '+[district,province,department].filter(Boolean).map(short).join(', ')+'. '+text(p.peligro_nivel,650),
  };
}
export function readPhisisIndex(body, now) {
  const data=JSON.parse(body);
  if (data.type!=='FeatureCollection' || !Array.isArray(data.features) ||
      !Number.isSafeInteger(data.totalFeatures) || data.totalFeatures!==data.features.length) throw Error('Listado PHISIS incompleto');
  const records=data.features.map(feature=>featureRecord(feature,now));
  if (new Set(records.map(r=>r.id)).size!==records.length) throw Error('Listado PHISIS ambiguo');
  return records;
}
const active = (record) => ['vigente','emitido'].includes(fold(record.sourceStatus));
function cleanRecord(record) {
  const {firstSeenAt,lastChangedAt,version,sourceName,kind,...raw}=record;
  return raw;
}
function combine(web, indexed) {
  if (!web) return indexed;
  // An official link and number must both match before carrying old precision.
  if (web.url!==indexed.url || web.noticeNumber!==indexed.noticeNumber) return indexed;
  const result={...indexed,...cleanRecord(web)};
  const currentMetadata=['stationName','stationProvince','stationDistrict','observedAt','phisisListedAt','level','sourceStatus','coverageUrls'];
  for (const key of currentMetadata) if (indexed[key]!==undefined) result[key]=indexed[key];
  if (!web.summary) result.summary=indexed.summary;
  if (!web.locality) result.locality=indexed.locality;
  if (!web.regions?.length || web.regionOrigin==='estacion-phisis') {
    Object.assign(result,{regions:indexed.regions,region:indexed.region,regionOrigin:indexed.regionOrigin});
  }
  delete result.withdrawnAt;
  delete result.supersededBy;
  delete result.supersededUrl;
  return result;
}
export function riverSource({fetchWeb,read,diagnose}) {
  return async ({previousItems=[],now=new Date(),onReading}={})=>{
    const [html,geo]=await Promise.allSettled([
      fetchWeb(),
      read(phisisRiverIndex,{redirect:'error'}).then(r=>readPhisisIndex(r.body,now)),
    ]);
    if (html.status==='rejected' && geo.status==='rejected') throw html.reason;
    if (geo.status==='rejected') {
      onReading?.({readChannel:'web',phisisErrorCode:diagnose(geo.reason)});
      return html.value;
    }
    const fromWeb=html.status==='fulfilled';
    const current=new Map(geo.value.map(r=>[r.id,r]));
    const formerly=new Map(previousItems.map(r=>[r.id,r]));
    const result=[];
    const rows=fromWeb ? html.value : previousItems;
    for (const row of rows) {
      if (current.has(row.id)) {
        result.push(combine(row,current.get(row.id)));
        current.delete(row.id);
      } else {
        const raw=cleanRecord(row);
        // Some HTML rows marked 'emitido' refer to future valid intervals and
        // legitimately precede a station's appearance on the active-only map.
        const announced=fold(raw.sourceStatus)==='emitido' && Date.parse(raw.validFrom)>+now;
        if (!fromWeb && !announced && (raw.phisisListedAt || active(raw)) && !raw.supersededBy) {
          raw.withdrawnAt=raw.withdrawnAt || now.toISOString();
          raw.sourceStatus='fuera del listado PHISIS';
        }
        result.push(raw);
      }
    }
    for (const value of current.values()) result.push(combine(formerly.get(value.id), value));
    const stats={readChannel:fromWeb?'web+phisis':'phisis',phisisCheckedAt:now.toISOString(),phisisCount:geo.value.length};
    if (!fromWeb) stats.webErrorCode=diagnose(html.reason);
    onReading?.(stats);
    return result;
  };
}
