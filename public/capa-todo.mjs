import {riverValidity} from "./estacion-hidrologica.mjs";
const day=24*3600000;
export const combinedPriority={grave:0,impacto:1,reportado:2,restablecido:3,observacion:4,pronostico:5};
export const combinedLabels={
  grave:"Impacto grave confirmado",impacto:"Impacto documentado",reportado:"Impacto reportado",
  restablecido:"Restablecimiento comunicado",observacion:"Medición, aviso de estación o parte operativo",pronostico:"Cobertura de pronóstico",
};
export function initialLayer(query) {
  const explicit=query.get("capa");
  if(["todo","mar","lluvias","rios"].includes(explicit))return explicit;
  if(query.has("region") && !query.has("ubigeo") && !query.has("vista"))return "mar";
  if(["capa","ubigeo","ciudad","local","peligro","aviso","vista","mapa","tema"].some(k=>query.has(k)))return "lluvias";
  return "todo";
}
export function combinedTime(s) {
  const e=s.event;
  if(s.mark==="grave")return e?.severityEvidence?.at || e?.occurredAt || s.at;
  if(s.mark==="restablecido")return e?.recovery?.at || e?.reportedAt || s.at;
  if(e)return e.occurredAt || e.reportedAt || s.at;
  return s.type==="puerto" && s.checkedAt || s.at;
}
export function currentCombined(s,now) {
  if(s.mode==="pronostico")return true; // localSignals already checks validity in Peru, including future advisories.
  if(s.type==="estacion" && s.item) {
    const status=riverValidity(s.item,now);
    if(["vigente","listado"].includes(status))return true;
    if(!s.observedAt || ["sinconfirmar","actualizado","retirado","proximo"].includes(status))return false;
  }
  const at=Date.parse(combinedTime(s));
  return at<=now && now-at<=day;
}
function regionMark(s) {
  if(s.mode==="pronostico")return "pronostico";
  if(s.type!=="impacto")return "observacion";
  const e=s.event;
  if(s.mark==="restablecido")return "restablecido";
  if(s.mark==="grave" && (e?.kind==="oficial" || e?.corroborated===true))return "grave";
  if(e?.occurredAt && (e.kind==="oficial" || e.corroborated===true))return "impacto";
  // Require a reported consequence from a single press source. A regional
  // warning, preventive measure or forecast on its own establishes no impact.
  const headline=String(e?.title || s.title || "").normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
  if(e?.kind==="prensa" && (/\b(?:preve\w*|pronostic\w*|podria\w*|potencial\w*|riesgos?|alertas?|posibilid\w*|simulacro)\b/.test(headline) ||
    !/\b(?:danos?|afecta\w*|inunda\w*|desbord\w*|bloque\w*|aislad\w*|aneg\w*|empoz\w*|evacua\w*|interrump\w*|cierr\w*|cierre|destruy\w*|destru\w*|colaps\w*|socav\w*|sin (?:agua|luz|paso)|intransitabl\w*)\b/.test(headline)))return "";
  return "reportado";
}
export function combinedSignals(signals,now=Date.now()) {
  const seen=new Set(),corroborated=new Set();
  for(const s of signals)if(s.event?.corroborated && currentCombined(s,now))
    for(const ref of [...(s.event.relatedItems || []),...(s.event.contributors || [])])if(ref.url && ref.url!==s.url)corroborated.add(ref.url);
  return signals.filter(s=>{
    if(!currentCombined(s,now) || !regionMark(s))return false;
    if(s.event?.kind==="prensa" && !s.event.corroborated && corroborated.has(s.url))return false;
    if(seen.has(s.id))return false;
    seen.add(s.id);return true;
  }).map(s=>({...s,combinedMark:regionMark(s)}));
}
export function regionalOverview(signals) {
  const groups=new Map();
  for(const s of signals) {
    const mark=regionMark(s);
    if(!mark)continue;
    for(const region of new Set(s.region?[s.region]:(s.regions || []))) {
      const before=groups.get(region);
      if(!before || combinedPriority[mark]<combinedPriority[before.mark] || mark===before.mark && Date.parse(combinedTime(s))>Date.parse(combinedTime(before.signal)))
        groups.set(region,{region,mark,signal:s});
    }
  }
  return [...groups.values()].sort((a,b)=>combinedPriority[a.mark]-combinedPriority[b.mark] || Date.parse(combinedTime(b.signal))-Date.parse(combinedTime(a.signal)) || a.region.localeCompare(b.region,"es"));
}
