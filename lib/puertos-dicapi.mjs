import {detectsPersonalData} from './privacidad.mjs';

export const dicapiUrl = 'https://www.dicapi.mil.pe/estado-de-puertos';
const api = new URL('/api/ports', dicapiUrl).href;
// Facility IDs, grouped after checking the port name and published location.
// A captaincy can serve several departments. New IDs remain visible nationally.
// The APN national terminal directory places Conchán and UNACEM in Lurín,
// and Melchorita in Cañete. MINCETUR's inventory record 14062 places Puerto
// Lagunas in Alto Amazonas, Loreto, despite the point shown by the map.
// https://cdn.www.gob.pe/uploads/document/file/471487/Anexo_2_-_FIchas_T%C3%A9cnicas_100_TPs_y_EMBs_Versipin_221019.pdf
// https://consultasenlinea.mincetur.gob.pe/fichaInventario/index.aspx?cod_Ficha=14062
// MINCETUR identifies Orellana (Capitanía de Pucallpa) in Vargas Guerra, Loreto:
// https://consultasenlinea.mincetur.gob.pe/fichaInventario/index.aspx?cod_Ficha=14117
const jurisdictions = {
  Zorritos: {Tumbes:[16,17,18,19,20,21,22]},
  Talara: {Piura:[32,33,34,35,36,37,38,39,40,41,146]},
  Paita: {Piura:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]},
  Pimentel: {Lambayeque:[23,24,25,26,27]},
  Salaverry: {'La Libertad':[28,29,30,31,145,147,148,149,150,151,158]},
  Chimbote: {'Áncash':[50,51,52,53,54,55,56,57,58,59,60,137]},
  Supe: {'Áncash':[76,77,78],Lima:[79,80,81,82]},
  Huacho: {Lima:[62,63,64]},
  Chancay: {Lima:[61,136,159,160,161,162]},
  Callao: {Callao:[43,44,45,46],'Lima Metropolitana':[42,47,48,49]},
  Pisco: {Lima:[65,66],Ica:[67,68,69,70,71,72,73,74,75]},
  'San Juan': {Ica:[83,84,85],Arequipa:[86,87,88,89,90]},
  Mollendo: {Arequipa:[106,107,108,109,110,111,112,113,140,141]},
  Ilo: {Moquegua:[95,96,97,98,99,100,101,104,105],Tacna:[102,103,143]},
  Puno: {Puno:[91,92,93,94]},
  'Pto. Maldonado': {'Madre de Dios':[114,115,152,153,154,155,156]},
  Pucallpa: {Loreto:[116,119],Ucayali:[117,120,121,122,123,124,125,126]},
  Iquitos: {Loreto:[127,128,129,130,131,132,133,134]},
  Yurimaguas: {Loreto:[135]},
};
const fluvial = new Set(['Pto. Maldonado','Pucallpa','Iquitos','Yurimaguas']);
const regionByFacility = new Map(Object.entries(jurisdictions).flatMap(([captaincy,groups]) =>
  Object.entries(groups).flatMap(([region,ids]) => ids.map(id => [captaincy+'|'+id,region]))));

const officialStatus = new Map([
  ['puerto abierto','open'],['cierre parcial del puerto','partial'],['cierre total del puerto','closed'],
]);
const counts = () => ({total:0,open:0,partial:0,closed:0});
function resolutionUrl(value) {
  if (typeof value!=='string') return null;
  try {
    const url=new URL(value);
    return url.origin===new URL(dicapiUrl).origin && !url.username && !url.password && !url.search && !url.hash &&
      /^\/storage\/state-ports\/[\w-]+\.(?:pdf|jpe?g|png)$/i.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
function label(value) {
  return typeof value==='string' && value.trim() && value.length<=220 && !detectsPersonalData(value)
    ? value.trim().replace(/\s+/g,' ') : null;
}

export function portStatus(details,summary) {
  if (details?.status!==0 || summary?.status!==0 || !Array.isArray(details.data) || !Array.isArray(summary.data) ||
      !details.data.length || !summary.data.length) throw new Error('Listado de puertos incompleto');
  const total=counts(),coastal=counts(),areas={},ports=[],ids=new Set();
  for (const r of details.data) {
    const name=label(r?.port), captaincy=label(r?.captaincy), status=officialStatus.get(r?.levelName?.toLowerCase());
    if (!Number.isInteger(r?.portId) || ids.has(r.portId) || !name || !captaincy || !status || !/^Nivel (I|II|III|IV|V)$/i.test(r.level))
      throw new Error('Estado portuario no reconocido');
    ids.add(r.portId);
    const area=captaincy==='Puno' ? 'Lacustre' : fluvial.has(captaincy) ? 'Fluvial' :
      Object.hasOwn(jurisdictions,captaincy) ? 'Marítimo' : 'Sin clasificar';
    const region=regionByFacility.get(captaincy+'|'+r.portId);
    const date=/^20\d\d-\d\d-\d\dT/.test(r.publication_date) && Number.isFinite(Date.parse(r.publication_date))
      ? new Date(r.publication_date).toISOString() : null;
    const url=resolutionUrl(r.resolution_url);
    ports.push({name,captaincy,area,status,level:r.level,...region&&{region},...date&&{date},...url&&{url}});
    const groups=[total,areas[area]??=counts()];
    if (area==='Marítimo') groups.push(coastal);
    for (const group of groups) { group.total++; group[status]++; }
  }
  const expected=counts();
  for (const level of summary.data) {
    const status=officialStatus.get(level?.name?.toLowerCase());
    if (!status || !Number.isSafeInteger(level.total) || level.total<0) throw new Error('Resumen de DICAPI no reconocido');
    expected[status]+=level.total;
    expected.total+=level.total;
  }
  if (Object.keys(expected).some(key=>expected[key]!==total[key])) throw new Error('El listado difiere del resumen de DICAPI');
  return {...total,coastal,areas,ports};
}

export function dicapiReader(read) {
  return async ({onReading}) => {
    const [details,summary]=await Promise.all([api,api+'?sumary=true'].map(async url=>JSON.parse((await read(url)).body)));
    onReading({portStatus:portStatus(details,summary)});
    return []; // The operating status of a facility is separate from weather warnings.
  };
}
