import {mostrarHistoria} from "./historia-comparada.mjs";
import {explorer} from "./explorar.mjs?v=8";
import {applyVerifiedPressLocations} from "./ubicacion-prensa.mjs";
import {initialLayer,combinedLabels,regionalOverview} from "./capa-todo.mjs?v=2";
import {isRiverNotice,stationReading,riverValidity} from "./estacion-hidrologica.mjs";
import {signalDates} from "./resumen-territorial.mjs?v=2";
import {loadTerritories,normalizePlace,noticeCovers,regionTitle} from "./territorios.mjs?v=3";
import {shareControl,sharePayload} from "./compartir.mjs?v=2";
import {recordDates,recordSources} from "./ficha-aviso.mjs";
import {visualPanel} from "./material-visual.mjs";
import {avisoKey,resolveAviso} from "./enlaces-aviso.mjs";
import { createMap, mapCities } from "./atlas-map.mjs?v=9";
import {editionAsset} from "./publicacion.mjs";
import {renderRegionalPress} from "./prensa-regional.mjs?v=3";
import {portStatusPanel} from "./puertos.mjs";
import { layerRecords, noticeForRegionDay } from "./avisos-mapa.mjs?v=4";
const $ = (id) => document.getElementById(id);
const node = (tag, text = "", css = "") => {
  const el = document.createElement(tag);
  el.textContent = text;
  if (css) el.className = css;
  return el;
};
const fold = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const prepUrl =
  "https://www.gob.pe/institucion/indeci/campa%C3%B1as/143492-preparados-ante-el-fenomeno-el-nino";
const enfenUrl = "https://enfen.imarpe.gob.pe/comunicados/";
const knownRegions = [
  "Amazonas",
  "Áncash",
  "Apurímac",
  "Arequipa",
  "Ayacucho",
  "Cajamarca",
  "Callao",
  "Cusco",
  "Huancavelica",
  "Huánuco",
  "Ica",
  "Junín",
  "La Libertad",
  "Lambayeque",
  "Lima",
  "Lima Metropolitana",
  "Loreto",
  "Madre de Dios",
  "Moquegua",
  "Pasco",
  "Piura",
  "Puno",
  "San Martín",
  "Tacna",
  "Tumbes",
  "Ucayali",
];
const regionLabel = (name) => (name === "Lima" ? "Lima Provincias" : name);
function findRegion(name) {
  return (
    knownRegions.find(
      (n) => fold(n) === fold(name) || fold(regionLabel(n)) === fold(name),
    ) || ""
  );
}
function findCity(value, regionName = "") {
  const name = fold(value)
    .trim()
    .replace(/\s*\(ciudad\)$/, "");
  return mapCities.find(
    (city) =>
      fold(city.name) === name && (!regionName || city.region === regionName),
  );
}
function namesCity(item, city) {
  if (!city) return false;
  const name = fold(city);
  if (fold(item.locality).trim() === name) return true;
  const title = fold(item.title);
  return ["distrito de ", "ciudad de "].some((prefix) => {
    const rest = title.split(prefix)[1];
    return (
      rest?.split(/(?:\s*[–—,:;()]|\s+-\s+|\s+en la provincia)/)[0].trim() ===
      name
    );
  });
}
let panel = null,
  mappedItems = [],
  layer = "todo",
  mode = "ahora",
  hazard = "lluvias",
  ubigeo = "",
  catalog = null,
  feed = "oficial",
  region = "",
  selectedCity = "",
  localOnly = false,
  query = "",
  topic = "",
  period = "",
  fromLayer = false,
  limit = 8,
  map = null,
  oceanTime = null,
  oceanProduct = "",
  oceanSource = null,
  editionInFlight = null,
  editionReadFailed = false,
  audio = null,
  speaking = false;
const dateOptions={timeZone:"America/Lima", day:"2-digit",month:"short",year:"numeric"};
const limaDay=new Intl.DateTimeFormat("es-PE",dateOptions);
const limaTime=new Intl.DateTimeFormat("es-PE",{...dateOptions,hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function dateTime(value) {
  if (!value) return "";
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dayOnly ? value + "T12:00:00-05:00" : value);
  if (!Number.isFinite(d.getTime())) return "";
  return (dayOnly ? limaDay : limaTime).format(d);
}
function eventTime(item) {
  return item.publishedAt || item.validFrom || "";
}
function ending(value) {
  return Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T23:59:59.999-05:00" : value,
  );
}
function safeUrl(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
function link(text, url) {
  const a = node("a", text);
  const href = safeUrl(url);
  if (href) {
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
}
let dialogRequest = 0;
function dialog(kind, title, ...content) {
  dialogRequest++;
  $("dialogKind").textContent = kind;
  $("dialogTitle").textContent = title;
  $("dialogBody").replaceChildren(...content);
  if (!$("infoDialog").open) $("infoDialog").showModal();
}
async function recordDialog(record, fromLink, ...content) {
  if (fromLink) return dialog(...content);
  const request = ++dialogRequest;
  const before = location.href;
  const token = await avisoKey(record).catch(() => "");
  if (request !== dialogRequest || location.href !== before) return;
  if (token) {
    const url = new URL(before);
    url.searchParams.set("aviso", token);
    if (url.href !== before) history.pushState({atlasNotice:token}, "", url);
    $("infoDialog").dataset.sharedNotice = token;
    openedNotice = token;
  }
  dialog(...content);
}
let leavingNotice = false;
function dismissDialog() {
  const modal = $("infoDialog");
  const token = modal.dataset.sharedNotice;
  const url = new URL(location.href);
  dialogRequest++;
  if (token && url.searchParams.get("aviso") === token) {
    if (history.state?.atlasNotice === token) {
      // Keep the dialog open until popstate restores the map. A deferred
      // traversal after closing can displace the visitor's next navigation.
      if (!leavingNotice) history.back();
      leavingNotice = true;
      return;
    }
    // A direct link can be the first page in the tab.
    url.searchParams.delete("aviso");
    history.replaceState(history.state, "", url);
  }
  delete modal.dataset.sharedNotice;
  openedNotice = "";
  modal.close();
}
$("closeDialog").onclick = dismissDialog;
$("infoDialog").addEventListener("cancel", e => {
  e.preventDefault();
  dismissDialog();
});
$("infoDialog").addEventListener("click", (e) => {
  const r = $("infoDialog").getBoundingClientRect();
  if (
    e.target === $("infoDialog") &&
    (e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom)
  )
    dismissDialog();
});
function topics(item) {
  const t = fold(
    [item.category, item.title, item.phenomenon].filter(Boolean).join(" "),
  );
  return {
    lluvias:
      /lluvia|quebrada|huaico|huayco|precipitaci|granizada|inundaci|tormenta/.test(
        t,
      ),
    rios: /\brios?\b|hidrolog|desbord|caudal/.test(t),
    mar: /el nino|oleaje|oceanic|marino|portuario/.test(t),
    agua:
      /agua potable|alcantarillado|sunass/.test(t) ||
      item.sourceId === "sunass",
  };
}
function places(item) {
  const names=Array.isArray(item.regions)
    ? item.regions
    : String(item.region || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
  if(names.length===1 && names[0]==="Lima" && item.localEvidence?.district && catalog) {
    const code=catalog.resolve("Lima",item.localEvidence.province,item.localEvidence.district);
    if(code.length===6 && catalog.regionOf(code)==="Lima Metropolitana")return ["Lima Metropolitana"];
  }
  return names;
}
function inRegion(item, name) {
  return regionNamesFor(item).some((v) => fold(v) === fold(name));
}
function regionNamesFor(item) {
  return [
    ...new Set([
      ...places(item),
      ...(Array.isArray(item.coastalRegions) ? item.coastalRegions : []),
    ]),
  ];
}
function coastalSegments(item, area) {
  const segments = item.coastalByRegion?.[area] || item.coastalScope;
  return Array.isArray(segments) ? segments : [];
}
function startOf(value) {
  return value
    ? Date.parse(
        /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T00:00:00-05:00" : value,
      )
    : NaN;
}
const periodNames = {
  vigente: "Vigente",
  proximo: "Próximo",
  finalizado: "Finalizado",
  publicado: "Sin vigencia definida",
  actualizado: "Sustituido",
  listado: "En el listado de SENAMHI",
  sinconfirmar: "Vigencia sin confirmar",
  retirado: "Retirado del listado",
};
function validity(item, now = Date.now()) {
  if (isRiverNotice(item)) return riverValidity(item,now);
  if (item.supersededBy) return "actualizado";
  if (item.withdrawnAt) return "retirado";
  const start = startOf(item.validFrom),
    end = ending(item.validUntil);
  if (end < now) return "finalizado";
  if (start > now) return "proximo";
  if (start <= now && end >= now) return "vigente";
  return "publicado";
}
function mapPeriod(item) {
  if (item.invalidValidity) return "";
  const state = validity(item);
  if (state === "vigente" || state === "listado") return "active";
  if (state === "proximo") return "upcoming";
  const age = Date.now() - startOf(eventTime(item));
  return state === "publicado" && age >= 0 && age <= 72 * 3600000
    ? "recent"
    : "";
}
function onLayer(item) {
  if (item.kind !== "oficial" || !mapPeriod(item)) return false;
  return layer === "todo" ? ["mar","lluvias","rios"].some(theme=>fitsLayer(item,theme)) : fitsLayer(item,layer);
}
function fitsLayer(item,theme) {
  if (theme === "mar")
    return (
      item.sourceId === "marina" ||
      (item.sourceId === "coen" &&
        item.category === "Oleajes" &&
        /^reporte\b/i.test(item.title))
    );
  if (item.sourceId === "coen" && !item.originNotice)
    return theme === "rios"
      ? item.category === "Ríos"
      : ["Lluvias", "Quebradas"].includes(item.category) ||
          (item.category === "Ríos" &&
            /lluvias|precipitaci/.test(fold(item.title)));
  const issuer = item.originNotice?.sourceId || item.sourceId;
  if (theme === "rios") return issuer === "senamhi-rios";
  return (
    ["senamhi-lluvias", "senamhi-quebradas","senamhi-radar"].includes(issuer) ||
    (issuer === "senamhi-meteo" && topics(item).lluvias)
  );
}
function levelFor(item, area = "") {
  const levels =
    area &&
    item.regionLevels &&
    Object.entries(item.regionLevels).find(
      ([key]) => fold(key) === fold(area),
    )?.[1];
  if (Array.isArray(levels) && levels.length)
    return (
      "Sectores en " + levels.map((x) => String(x).toLowerCase()).join(", ")
    );
  return item.level
    ? "Nivel del aviso · " + String(item.level).toLowerCase()
    : "";
}
function localContext(item) {
  if (region && inRegion(item, region)) return regionLabel(region);
  const names = regionNamesFor(item).map(regionLabel);
  if (names.length > 2)
    return names.slice(0, 2).join(", ") + " y " + (names.length - 2) + " más";
  return (
    names.join(", ") ||
    (item.sourceId === "enfen"
      ? "Pacífico tropical"
      : coastalSegments(item).length
        ? "Litoral peruano"
        : "")
  );
}
function simpleTitle(title) {
  const words = String(title || "").trim();
  return words && words === words.toUpperCase()
    ? words[0]?.toUpperCase() + words.slice(1).toLocaleLowerCase("es-PE")
    : words;
}
function explanationCredit(note) {
  if (note.mode !== "ia") return "Según la fuente";
  return note.method === "seleccion"
    ? "Explicación seleccionada con IA"
    : "Explicación con IA";
}
function explanationFor(item) {
  const note = panel?.explanations?.notices?.[item.id];
  if (note?.what && note.meaning && ["ia", "fuentes"].includes(note.mode) && (!isRiverNotice(item) || stationReading(item)))
    return note;
  let what = simpleTitle(item.phenomenon || item.title);
  let meaning = "";
  if (item.sourceId === "sunass") {
    what = (item.summary || what).replace(/^Registro\s+[\d-]+\.\s*/i, "");
    if (item.locality) what = item.locality + " · " + what;
    if (item.validFrom)
      meaning = "Inicio comunicado para el " + dateTime(item.validFrom) + ".";
    if (item.expectedRestorationAt)
      meaning +=
        " Reposición prevista para el " +
        dateTime(item.expectedRestorationAt) +
        ".";
  } else if (
    topics(item).rios &&
    (item.sourceId === "senamhi-rios" ||
      item.originNotice?.sourceId === "senamhi-rios")
  ) {
    const reading=stationReading(item);
    const station =
      reading?.name || item.stationName ||
      (item.title || "").match(/\bestación\s+([^()]+)$/i)?.[1] ||
      item.locality;
    const river = (item.title || "").match(
      /\brío\s+(.+?)\s+[-–—]\s+estación/i,
    )?.[1];
    const placeName = (name) =>
      String(name)
        .trim()
        .toLocaleLowerCase("es-PE")
        .replace(
          /(^|\s)(\p{L})/gu,
          (all, boundary, letter) =>
            boundary + letter.toLocaleUpperCase("es-PE"),
        );
    const level = item.level && String(item.level).toLocaleLowerCase("es-PE");
    const riverName=river ? " "+placeName(river) : "";
    if(reading) {
      const subject=reading.metric ? "el "+reading.metric+" del río" : "el río";
      what="SENAMHI midió "+subject+riverName+" en la estación "+placeName(reading.name)+
        (reading.value?" ("+reading.value+")":"")+".";
    } else if(station) {
      what="SENAMHI publicó un aviso del río"+riverName+" para la estación "+placeName(station)+".";
    }
    if(level)what+=" El aviso indica umbral "+level+".";
    meaning=reading ? "La medición corresponde al río en esa estación. La ficha oficial identifica los poblados que podrían verse afectados." :
      "La ficha oficial describe la vigencia, la ubicación y los posibles efectos del aviso.";
  } else if (
    item.sourceId === "senamhi-lluvias" ||
    item.sourceId === "senamhi-quebradas"
  ) {
    what =
      item.sourceId === "senamhi-lluvias"
        ? "SENAMHI prevé lluvias intensas en sectores de la región."
        : "SENAMHI advierte que algunas quebradas podrían activarse con las lluvias.";
    meaning = "Consulta las zonas incluidas y la vigencia en el aviso.";
  }
  return { what, meaning: meaning.trim(), mode: "fuentes" };
}
function shareLocation() {
  return {region, ubigeo, ciudad:selectedCity, capa:layer, vista:mode, peligro:hazard};
}
// The map ends at the province. Incoming district codes still identify the
// original record, whose dates and cited district remain in its own notice.
const cityProvinces={Piura:"2001",Iquitos:"1601",Lima:"1501",Cusco:"0801",Arequipa:"0401"};
function mapProvince(code,regionName) {
  if (/^\d{4}(?:\d{2})?$/.test(code || "")) return code.slice(0,4);
  return regionName==="Lima Metropolitana" ? "1501" : "";
}
function placeForSharing() {
  return (ubigeo && catalog?.label(ubigeo)) ||
    [selectedCity,regionLabel(region)].filter(Boolean).join(" · ") || "Todo el Perú";
}
function placePayload() {
  const place=placeForSharing();
  const heading=mode==="pronostico" ? "Pronóstico" : "Último corte";
  const records=localExplorer.current;
  const first=layer==="todo" ? regionalOverview(records)[0]?.signal || records[0] : records[0];
  const evidence=first?.combinedMark && first.type==="impacto" ? combinedLabels[first.combinedMark] : first?.label;
  const example=first && [evidence,first.title,signalDates(first)].filter(Boolean).join(" · ");
  const situation=records.length
    ? [records.length+(records.length===1?" reporte en esta vista.":" reportes en esta vista."), example].join(" ")
    : mode==="pronostico"?"Sin pronóstico publicado con este alcance en la edición consultada.":"Sin reporte reciente para este lugar en la edición consultada.";
  return sharePayload({...shareLocation(),place,title:place+" · "+layerNames[layer]+" · "+heading,
    situation:panel?situation:"Consulta la edición disponible en el mapa.",source:"Perú al Día · edición",at:panel?.updatedAt});
}
function noticeShare(record) {
  const container=node("div");
  // Prepare the identifier before the click so the native share sheet keeps user activation.
  void avisoKey(record).then(aviso=>{
    if(!aviso)return;
    container.replaceChildren(shareControl(()=>{
      const selection=shareLocation();
      const recordRegions=record.regions?.length?record.regions:record.region?[record.region]:[];
      const area=record.area || record.ubigeo;
      if(!selection.region && recordRegions.length===1) {
        selection.region=findRegion(recordRegions[0]);
        if(area && catalog?.regionOf(area)===selection.region)selection.ubigeo=mapProvince(area,selection.region);
      }
      if(record.mode)selection.vista=record.mode;
      if(record.layer && selection.capa!=="todo")selection.capa=record.layer;
      if(record.sourceId==="senamhi-quebradas")selection.peligro="quebradas";
      const place=[record.locality,record.district,record.province,record.region].filter(Boolean);
      const selectedCoverage=ubigeo && (record.area===ubigeo || noticeCovers(record.item || record,ubigeo,catalog));
      const locationLabel=selectedCoverage ? placeForSharing() : [...new Set(place)].join(" · ") || recordRegions.join(", ") || "Perú";
      const signal=Boolean(record.type && record.mode);
      const validityText=signal?record.label:record.validUntil || record.withdrawnAt || record.supersededBy?periodNames[validity(record)]:"";
      const until=record.expiresAt || record.validUntil;
      const situation=[validityText,until && "Vigencia hasta "+dateTime(until),record.event?.recovery?.text || record.text || record.summary].filter(Boolean).join(" · ");
      return sharePayload({...selection,aviso,place:locationLabel,title:record.title,situation,
        source:record.sourceName || record.source || record.sourceId,at:record.issuedAt || record.publishedAt || record.at || record.validFrom});
    },{label:record.kind==="prensa" || record.event?.kind==="prensa" ? "Compartir noticia" : "Compartir este aviso"}));
  }).catch(()=>{container.textContent="Enlace de este aviso no disponible.";});
  return container;
}
let openedNotice="";
let territoriesReady=false;
let lastShareScope="";
let initialPressAnchor=location.hash==="#prensa-regional";
if(initialPressAnchor) {
  for(const event of ["pointerdown","wheel","keydown"])
    window.addEventListener(event,()=>{initialPressAnchor=false;},{once:true,passive:true});
}
async function openSharedNotice() {
  const token=new URLSearchParams(location.search).get("aviso");
  if(!panel || !token || token===openedNotice || (!territoriesReady && ubigeo))return;
  openedNotice=token;
  let found;
  try {
    found=await resolveAviso(token,{items:panel.items,signals:localExplorer.signals,originals:panel.sharedOriginals});
  } catch {found={kind:"missing"};}
  if(openedNotice!==token || new URLSearchParams(location.search).get("aviso")!==token)return;
  $("infoDialog").dataset.sharedNotice=token;
  if(found.kind==="signal")return localExplorer.signalDialog(found.record,true);
  if(found.kind==="item") {
    const scoped=region && noticeForRegionDay(found.record,region,Date.now(),ubigeo,catalog);
    return showRecord(scoped || found.record,true);
  }
  if(found.kind==="invalid")return dialog("Enlace compartido","El enlace del aviso está incompleto",
    node("p","Cierra esta ficha para consultar los reportes disponibles del lugar."));
  const fields=[node("p","Esta ficha ya no figura en la edición consultada. Puedes cerrar esta ventana y revisar el corte más reciente del mapa.")];
  if(found.originalUrl)fields.push(link("Consultar la publicación original ↗",found.originalUrl));
  if(found.sourceDirectoryUrl) {
    if(found.sourceRecordId)fields.push(node("p","Código del registro · "+found.sourceRecordId));
    fields.push(link("Consultar el registro de "+found.sourceName+" ↗",found.sourceDirectoryUrl));
  }
  dialog("Archivo de avisos","Aviso de una edición anterior",...fields);
}
function showRecord(item, fromLink=false) {
  const incident=impactOf(item);
  const signal=incident && localExplorer.signals.find(s=>s.event?.id===incident.id);
  if(signal) {localExplorer.signalDialog(signal,fromLink);return;}
  const source=item.sourceName || item.source || item.sourceId;
  const references=recordSources(node,link);
  references.add("Publicación original de "+source+" ↗", item.url);
  const fields = [];
  let explained = "";
  if (
    item.kind === "oficial" &&
    (panel?.explanations?.notices?.[item.id] || mapPeriod(item))
  ) {
    const note = explanationFor(item);
    explained = note.what;
    fields.push(node("p", note.what, "record-lead"));
    if (note.meaning) fields.push(node("p", note.meaning));
    fields.push(
      node(
        "small",
        note.mode === "ia"
          ? explanationCredit(note) + " basada en esta publicación."
          : "Lectura de la publicación oficial.",
      ),
    );
  }
  if (item.summary && ![item.title,explained].some(t=>fold(t)===fold(item.summary)))
    fields.push(node("p",item.summary,explained?"":"record-lead"));
  fields.push(node("p",source,"record-source"),noticeShare(item));
  if(item.validUntil || item.withdrawnAt || item.supersededBy)
    fields.push(node("p","Estado del aviso · "+periodNames[validity(item)]));
  fields.push(...recordDates([
    ["Inicio de la medición",item.observedFrom],["Medición registrada",isRiverNotice(item)?stationReading(item)?.at:item.observedAt],
    ["Publicación",item.publishedAt],["Día del pronóstico",item.forecastDate],
    ["Vigente desde",item.validFrom],["Vigente hasta",item.validUntil],
    ["Reposición prevista",item.expectedRestorationAt]
  ],node,dateTime));
  if (item.phisisListedAt && !item.validUntil)
    fields.push(
      node(
        "p",
        "Última aparición verificada en el listado hidrológico de SENAMHI: " +
          dateTime(item.phisisListedAt) +
          ".",
      ),
    );
  if (item.changes?.length) {
    const details=node("details","","record-timeline");
    details.append(node("summary","Qué cambió en este aviso"));
    for(const change of item.changes)details.append(node("p",dateTime(change.at)+" · "+change.text));
    fields.push(details);
  }
  if (item.withdrawnAt)
    fields.push(
      node(
        "p",
        "El aviso dejó de figurar en el listado activo el " +
          dateTime(item.withdrawnAt) +
          ".",
      ),
    );
  if (item.invalidValidity)
    fields.push(
      node(
        "p",
        "El boletín contiene fechas de vigencia contradictorias. Consulta el documento original.",
      ),
    );
  if (ubigeo && item.districtLevels?.[ubigeo]) {
    const levels=item.districtLevels[ubigeo].map(s=>s.toLowerCase()).join(" y ");
    fields.push(node("h3","Peligro en sectores del distrito"),node("p",catalog?.byId.get(ubigeo)?.name+" figura con nivel "+levels+". El nivel puede variar dentro del distrito. Consulta el mapa de la edición para localizar cada sector."));
  }
  if (isRiverNotice(item) && (item.stationDistrict || item.stationProvince))
    fields.push(node("p","Ubicación de la estación · "+[item.stationDistrict,item.stationProvince,item.regions?.join(", ")].filter(Boolean).join(" · ")));
  if (places(item).length)
    fields.push(node("p", "Ámbito mencionado: " + places(item).join(", ")));
  if (item.radarType) fields.push(node("p","Lugar citado por el parte · "+[item.locality,item.district,item.province,item.region].filter(Boolean).filter((p,i,a)=>a.indexOf(p)===i).join(", ")));
  const provinces = region && item.provincesByRegion?.[region];
  if (provinces?.length)
    fields.push(
      node(
        "p",
          "Provincias que identifica la fuente en " +
          regionLabel(region) +
          (item.provinceScopeDate ? " para el " + dateTime(item.provinceScopeDate) : "") +
          ": " +
          provinces.join(", ") +
          ".",
      ),
    );
  if (item.supersededBy)
    references.add("Actualizado por el aviso n.º "+item.supersededBy+" ↗",item.supersededUrl);
  const level = levelFor(item, region);
  if (level)
    fields.push(
      node(
        "p",
        level + (region && item.regionLevels?.[region] ? " · " + region : ""),
      ),
    );
  const segments = coastalSegments(item, region);
  if (region && item.applicableDates?.length)
    fields.push(node("p", "Días del pronóstico para " + regionLabel(region) + " · " +
      item.applicableDates.map((day) => dateTime(day)).join(" · ")));
  if (segments.length) {
    fields.push(
      node(
        "h3",
        region && item.coastalByRegion?.[region]
          ? "Tramo del litoral de " + regionLabel(region)
          : "Tramos del aviso de oleaje",
      ),
    );
    for (const seg of segments) {
      fields.push(node("strong", seg.zone + " · " + seg.stretch));
      for (const note of seg.conditions || []) fields.push(node("p", note));
    }
    if (item.coastalMappingSource?.url)
      references.add("Referencia geográfica de los tramos ↗", item.coastalMappingSource.url,
        "La jurisdicción se identifica por el tramo del litoral descrito por la Marina.");
  }
  for (const [i, url] of (item.coverageUrls || []).entries()) {
    if (safeUrl(url))
      references.add(
          (item.regionOrigin === "provincia-ficha-coen" && url === item.url
            ? "Ubicación confirmada por el COEN"
            : new URL(url).hostname === "portal.indeci.gob.pe"
              ? "Boletín oficial del COEN (PDF)"
              : ["senamhi-lluvias", "senamhi-quebradas"].includes(item.sourceId)
                ? "Visor actual de SENAMHI"
                : "Mapa oficial de cobertura") +
            (item.coverageUrls.length > 1 ? " · " + (i + 1) : "") +
            " ↗",
          url,
      );
  }
  if (item.sourceId === "coen" && item.originNotice) {
    fields.push(
      node(
        "p",
        "Este boletín del COEN reproduce el aviso n.º " +
          item.originNotice.number +
          " de SENAMHI (" +
          item.originNotice.year +
          ").",
      ),
    );
  }
  for (const reference of item.relatedNotices || []) {
    if (reference.url !== item.url && safeUrl(reference.url))
      references.add("Mismo aviso en "+(reference.source || reference.sourceId)+" ↗",reference.url);
  }
  if (item.regionCoverageRetainedAt)
    fields.push(
      node(
        "p",
        "Ámbito territorial recuperado en la lectura del " +
          dateTime(item.regionCoverageRetainedAt) +
          ".",
      ),
    );
  if (item.regionOrigin === "mapa-senamhi")
    fields.push(
      node(
        "p",
        "Ámbito territorial publicado en el mapa del aviso de SENAMHI.",
      ),
    );
  if (item.kind === "oficial" && (topics(item).lluvias || topics(item).rios)) {
    fields.push(
      node("h3", "Cómo prepararse"),
      node(
        "p",
        "Revisa con tu comunidad las zonas expuestas, las rutas de evacuación y los puntos de reunión señalados por la autoridad local.",
      ),
    );
    references.add("Guía oficial de preparación de INDECI ↗",prepUrl);
  }
  const visual=visualPanel(item,{addSource:references.add});
  if(visual)fields.push(visual);
  fields.push(...references.section());
  recordDialog(item,fromLink,
    item.kind === "oficial" ? "Publicación oficial" : item.kind==="prensa"?"Cobertura periodística":"Medios y regiones",
    item.title,
    ...fields,
  );
}
function impactOf(item) {
  return panel?.impacts?.events?.find(e=>e.itemId===item.id || (!e.itemId && e.url===item.url));
}
function locatedItem(item) {
  if (!ubigeo) return true;
  if (noticeCovers(item,ubigeo,catalog)) return true;
  const event=impactOf(item);
  return Boolean(event && catalog?.resolve(event.region,event.province,event.district)?.startsWith(ubigeo));
}
function renderItems() {
  renderRegionalPress({panel,region,showRecord});
  const all = panel?.items || [];
  const subset = fromLayer && region
    ? mappedItems.map((item) => noticeForRegionDay(item,region,Date.now(),ubigeo,catalog)).filter(Boolean)
    : fromLayer ? mappedItems : all;
  const list = subset.filter(
    (it) =>
      (feed === "todos" ||
        (feed === "oficial" ? it.kind === "oficial" : it.kind !== "oficial")) &&
      (!region || inRegion(it, region)) && locatedItem(it) &&
      (!localOnly || namesCity(it, selectedCity)) &&
      (!topic || fromLayer || topics(it)[topic]) &&
      (!period || validity(it) === period) &&
      (!fromLayer || onLayer(it)) &&
      (!query ||
        fold(
          [
            it.title,
            it.summary,
            it.sourceName,
            it.category,
            it.locality,
            ...regionNamesFor(it),
          ]
            .filter(Boolean)
            .join(" "),
        ).includes(fold(query))),
  );
  $("feedScope").textContent = region
    ? "Consulta regional"
    : "Consulta nacional";
  $("feedHeading").textContent = region
    ? "Avisos de " + (catalog?.byId.get(ubigeo)?.name || (localOnly ? selectedCity : regionLabel(region)))
    : "Avisos y reportes";
  $("listCount").textContent = panel
    ? list.length +
      (list.length === 1 ? " publicación" : " publicaciones") +
      (fromLayer ? " de la capa " + layerNames[layer] : "") +
      (list.length > limit ? " · mostrando " + limit : "")
    : "";
  $("clearFilters").hidden =
    !region && !query && !topic && !period && !fromLayer && feed === "oficial";
  $("items").replaceChildren();
  if (!list.length) {
    $("items").append(
      node(
        "p",
        !panel
          ? "Registro pendiente. Puedes consultar los enlaces de las entidades en Fuentes."
          : "No encontramos publicaciones para esta selección. Puedes ampliar los filtros o consultar las fuentes.",
        "empty",
      ),
    );
  }
  for (const item of list.slice(0, limit)) {
    const b = node("button", "", "item");
    b.type = "button";
    const src = node("span", "", "item-source");
    src.append(node("span", item.sourceName || item.source || item.sourceId));
    const state = validity(item);
    if (state !== "publicado")
      src.append(
        node("span", periodNames[state], "status-tag status-" + state),
      );
    const meta = node("span", "", "meta");
    const level = levelFor(item, region);
    if (level) meta.append(node("span", level, "level-tag"));
    const area = localContext(item);
    meta.append(
      node(
        "span",
        [area, dateTime(item.forecastDate || eventTime(item))]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    b.append(src, node("b", item.title), meta, node("span", "→", "arrow"));
    b.onclick = () => showRecord(item);
    $("items").append(b);
  }
  $("more").hidden = list.length <= limit;
  $("queryState").hidden = !query;
  $("queryState").querySelector("span").textContent = "Búsqueda · " + query;
  renderRegionCard();
}
const layerNames = { todo:"Todo", mar: "Mar", lluvias: "Lluvias", rios: "Ríos" };
function storyType(item) {
  if (item.sourceId === "sunass") return "Agua potable";
  if (item.sourceId === "marina") return "Oleaje";
  return item.category || "Reporte";
}
function regionStory(item, scope) {
  const note = explanationFor(item);
  const story = node("article", "", "region-story");
  const tag = storyType(item);
  const state = validity(item);
  const meta = node("div", "", "story-meta");
  meta.append(node("span", scope || tag, "story-topic"));
  if (scope) meta.append(node("span", tag));
  if (state !== "publicado") meta.append(node("span", periodNames[state]));
  story.append(meta, node("p", note.what, "story-what"));
  if (note.meaning && fold(note.meaning) !== fold(note.what)) {
    const meaning = node("p", "", "story-meaning");
    meaning.append(
      node("strong", "Qué significa"),
      document.createTextNode(" · " + note.meaning),
    );
    story.append(meaning);
  }
  const tramos = item.coastalByRegion?.[region]
    ?.map((s) => s.stretch)
    .filter(Boolean);
  const provinces = item.provincesByRegion?.[region];
  if (item.applicableDates?.length)
    story.append(node("p", "Pronóstico para el " + item.applicableDates.map((day) => dateTime(day)).join(" · "), "story-area"));
  if (tramos?.length)
    story.append(
      node("p", "Tramo del litoral: " + tramos.join(" · "), "story-area"),
    );
  else if (provinces?.length) {
    const extra = provinces.length - 3;
    story.append(
      node(
        "p",
        (item.provinceScopeDate ? "Provincias del " + dateTime(item.provinceScopeDate) : "Provincias incluidas") + " · " +
          provinces.slice(0, 3).join(", ") +
          (extra > 0 ? " y " + extra + " más." : "."),
        "story-area",
      ),
    );
  }
  const button = node("button", "", "preview-link story-source");
  button.type = "button";
  const time = eventTime(item);
  const source = item.sourceName || item.source || "Fuente oficial";
  button.textContent =
    [source, time && dateTime(time)].filter(Boolean).join(" · ") + " ›";
  button.setAttribute(
    "aria-label",
    "Ver ficha y fuente de " + source + ". " + item.title,
  );
  button.onclick = () => showRecord(item);
  const credit = node("small", explanationCredit(note), "story-credit");
  story.append(button, credit);
  return story;
}
function renderRegionCard() {
  $("regionCard").hidden = !region;
  $("mapHint").hidden = !!region;
  $("mapFrame").classList.toggle("has-region", Boolean(region));
  if (!region) return;
  const official = mappedItems.map((item) => noticeForRegionDay(item, region)).filter(Boolean).filter(
    (it) =>
      it.kind === "oficial" &&
      inRegion(it, region) &&
      mapPeriod(it) &&
      !(
        it.expectedRestorationAt &&
        ending(it.expectedRestorationAt) < Date.now()
      ),
  );
  const relevant = official.filter(onLayer);
  const theme=layer==="todo"?"mar, ríos y lluvias":layer==="mar"?"oleaje":layerNames[layer].toLowerCase();
  const general = !relevant.length && Boolean(selectedCity || layer === "mar");
  const candidates = general ? official : relevant;
  const ids =
    panel?.explanations?.regions?.[region]?.[general ? "general" : layer] || [];
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const ranked = [
    ...new Set([
      ...ids.map((id) => byId.get(id)).filter(Boolean),
      ...candidates,
    ]),
  ];
  // A city's water or incident reports remain useful while viewing a different layer.
  const direct = selectedCity ? official.filter((item) => namesCity(item, selectedCity)) : [];
  const first = direct[0] || ranked[0];
  const others = ranked.filter((item) => item !== first);
  // A second type of event adds context when the region has many similar station reports.
  const second = others.find((item) => storyType(item) !== storyType(first)) || others[0] || direct[1];
  $("regionScope").textContent = selectedCity
    ? "Ciudad · " + regionLabel(region)
    : general
      ? "Panorama regional"
      : "Región · " + layerNames[layer];
  $("regionTitle").textContent = selectedCity || regionLabel(region);
  $("regionCount").textContent = !panel
    ? "Consultando publicaciones oficiales…"
    : (selectedCity && direct.length
        ? direct.length + (direct.length === 1 ? " publicación menciona " : " publicaciones mencionan ") + selectedCity
        : general
        ? "Avisos regionales"
        : relevant.length +
          (relevant.length === 1 ? " publicación" : " publicaciones") +
          " de " +
          theme) +
      " · Corte del " +
      dateTime(panel.updatedAt);
  const preview = $("regionPreview");
  preview.replaceChildren();
  $("regionPreviewLabel").hidden = !panel;
  if (panel) {
    if (selectedCity && !direct.length && ranked.length)
      preview.append(
        node(
          "p",
          "Los avisos disponibles para esta consulta corresponden al ámbito regional de " +
            regionLabel(region) +
            ".",
          "brief-empty",
        ),
      );
    const primary = [first, second].filter(Boolean);
    const third =
      general &&
      ranked.find((item) =>
        primary.every((shown) => storyType(item) !== storyType(shown)),
      );
    for (const item of [...primary, third].filter(Boolean)) {
      const scope = selectedCity
        ? direct.includes(item)
          ? "En " + selectedCity
          : "En la región " + regionLabel(region)
        : "";
      const story = regionStory(item, scope);
      if (item === third) {
        const details = node("details", "", "region-more");
        details.append(
          node(
            "summary",
            "También en " + regionLabel(region) + " · " + storyType(item),
          ),
          story,
        );
        preview.append(details);
      } else preview.append(story);
    }
    if (!first)
      preview.append(
        node(
          "p",
          "En el último corte no encontramos avisos vigentes, próximos o recientes " +
            (general
              ? "para "
              : "de " + theme + " para ") +
            regionLabel(region) +
            ".",
          "brief-empty",
        ),
      );
  }
  const goToLocal = Boolean(selectedCity && direct.length);
  $("regionGo").textContent = goToLocal
    ? "Ver avisos de " + selectedCity + " ↓"
    : relevant.length
      ? "Ver avisos de " +
        theme +
        " ↓"
      : "Ver avisos de " + regionLabel(region) + " ↓";
  function openList(cityOnly, currentLayer) {
    localOnly = cityOnly;
    fromLayer = currentLayer;
    topic = currentLayer && layer!=="todo" ? layer : "";
    period = "";
    query = "";
    feed = "oficial";
    changed();
  }
  $("otherRegion").hidden = !(relevant.length || goToLocal);
  $("otherRegion").onclick = () => openList(false, false);
  $("regionGo").onclick = () => openList(goToLocal, !goToLocal && relevant.length > 0);
  // When the main link opens city-wide results, keep the selected layer one click away.
  if (goToLocal && relevant.length) {
    const layerLink = node("a", "Ver " + theme + " en " + regionLabel(region) + " ↓", "all-region");
    layerLink.href = "#avisos";
    layerLink.onclick = () => openList(false, true);
    preview.append(layerLink);
  }
  if (layer === "mar" || layer==="todo") {
    const ports = portStatusPanel(panel?.sources.find(s => s.id === "dicapi"), region, {node,link,dateTime,regionLabel});
    if (ports) preview.append(ports);
  }
}
function syncLayer() {
  const counts = new Map(),
    regionTotals = new Map(),
    regionStatus = new Map();
  for (const it of mappedItems) {
    const inLayer = onLayer(it);
    for (const name of regionNamesFor(it)) {
      regionTotals.set(name, (regionTotals.get(name) || 0) + 1);
      const local = inLayer && noticeForRegionDay(it, name);
      const state = local && mapPeriod(local);
      if (!state) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
      const stats = regionStatus.get(name) || {
        active: 0,
        upcoming: 0,
        recent: 0,
      };
      stats[state]++;
      regionStatus.set(name, stats);
    }
  }
  map?.select(region, selectedCity);
  const result=localExplorer.render({panel,items:mappedItems,index:catalog,map,region,area:ubigeo,city:selectedCity,view:mode,layer,hazard,readFailed:editionReadFailed});
  const shareScope=[region,ubigeo,selectedCity,layer,mode,hazard].join("|");
  if(shareScope!==lastShareScope) {
    lastShareScope=shareScope;
    $("sharePlace").replaceChildren(shareControl(placePayload,{label:"Compartir lugar"}));
  }
  const modeCounts=new Map();
  for (const signal of result.viewSignals)
    for (const r of signal.region?[signal.region]:(signal.regions || [])) modeCounts.set(r,(modeCounts.get(r)||0)+1);
  $("hazardChoice").hidden=!(layer==="lluvias" && mode==="pronostico");
  for(const b of document.querySelectorAll("[data-hazard]"))b.setAttribute("aria-pressed",String(b.dataset.hazard===hazard));
  map?.showLayer(layer, modeCounts, {
    loaded: Boolean(panel),
    regionTotals,
    regionStatus:null,
    regionMarks:layer==="todo"?new Map(result.overview.map(r=>[r.region,r.mark])):null,
  });
  if(layerSwitch.dataset.slideTo && layerSwitch.dataset.slideTo!==layer)stopLayerSlide();
  document.querySelectorAll("[data-layer]").forEach((b) => {
    const enable = b.dataset.layer === layer;
    b.classList.toggle("selected", enable);
    b.setAttribute("aria-pressed", String(enable));
  });
  $("legendTitle").textContent = layer==="mar" ? "Anomalía térmica del mar · °C"
    : mode==="pronostico" ? "Sectores con pronóstico"
    : layer==="todo" ? "Impactos y mediciones"
    : layer==="rios" ? "Estaciones y reportes" : "Lluvias e impactos";
  const count=result.current.length;
  const place=(ubigeo && catalog?.byId.get(ubigeo)?.name) || regionLabel(region);
  const localCount=count ? count+(count===1?" reporte":" reportes")+" en "+place : "Sin reportes en esta vista de "+place;
  const documented=result.overview.filter(r=>r.mark==="grave" || r.mark==="impacto").length;
  const nationalCount=layer==="todo" && mode==="ahora"
    ? documented+(documented===1?" región con impactos documentados":" regiones con impactos documentados")
    : modeCounts.size+(mode==="pronostico"?" ámbitos con pronóstico":" ámbitos con reportes")+" en Perú";
  $("coverageText").textContent = panel ? region ? localCount : nationalCount : "Consultando cobertura…";
  $("mapBack").hidden=!region;
  $("mapBack").textContent=ubigeo && region!=="Lima Metropolitana" ? "← Volver a la región "+regionLabel(region) : "← Ver todo el Perú";
  const layerSources =
    layer==="todo" ? mode==="ahora" ? ["coen","senamhi-radar","senamhi-rios","dicapi"] : ["marina","senamhi-radar","senamhi-lluvias","senamhi-quebradas","senamhi-meteo"]
    : layer === "mar"
      ? ["marina", "dicapi", "coen"]
      : layer === "rios"
        ? ["coen", "senamhi-rios"]
        : mode==="ahora"?["coen","senamhi-radar"]:["senamhi-lluvias", "senamhi-quebradas", "senamhi-meteo"];
  const delayed = (panel?.sources || []).filter(
    (s) => layerSources.includes(s.id) && ["stale", "error"].includes(s.status),
  );
  if (delayed.length) $("coverageText").textContent += " · lectura parcial";
  $("coverageText").disabled = !panel;
  $("coverageText").onclick = () => {
    if(region) {
      if(count)localExplorer.group(result.current,"Reportes de "+place);
      else dialog("Cobertura",place,node("p","La edición consultada no contiene reportes para este lugar en la capa seleccionada."));
      return;
    }
    if(mode==="ahora" || layer==="todo") {
      const title=layer==="todo" ? mode==="ahora" ? "Impactos y mediciones en el Perú" : "Pronósticos en el Perú" : "Cobertura de "+layerNames[layer].toLowerCase();
      if(result.viewSignals.length) localExplorer.group(result.viewSignals,title);
      else dialog("Cobertura",title,node("p","La edición no incluye reportes localizados para esta vista."));
      return;
    }
    const water =
      layer === "rios" &&
      panel?.sources.find((source) => source.id === "senamhi-rios");
    const audit = water?.coverageAudit;
    const verification = [];
    if (layer === "mar") {
      const ports = portStatusPanel(panel?.sources.find(s => s.id === "dicapi"), "", {node,link,dateTime,regionLabel});
      if (ports) verification.push(ports);
    }
    if (layer === "lluvias") {
      const source = panel?.sources.find((s) => s.id === "senamhi-muy-corto");
      if (source) {
        const times = source.nowcasting;
        verification.push(node("h3", "Lluvia en las próximas dos horas"));
        if (times?.observedAt && times.forecast2h) {
          verification.push(node("p", "Última observación del visor · " + dateTime(times.observedAt) +
            ". Último pronóstico a dos horas · " + dateTime(times.forecast2h) +
            (ending(times.forecast2h) < Date.now() ? ". Ese pronóstico ya venció." : ".")));
        }
        verification.push(node("p", "SENAMHI muestra el área de lluvia en una cuadrícula nacional. Puedes acercar el visor a tu localidad."),
          link("Consultar el visor de lluvia inmediata de SENAMHI ↗", source.url));
      }
    }
    if (Array.isArray(audit?.listed) && audit.asOf && safeUrl(audit.url)) {
      const count = audit.listed.length;
      const additions = (audit.additionalSinceCutoff || []).map((id) =>
        String(id).split("-").at(-1),
      );
      verification.push(
        node("h3", "Cruce con el parte nacional de ríos"),
        node(
          "p",
          "El parte del COEN del " +
            dateTime(audit.asOf) +
            " consignó " +
            count +
            (count === 1 ? " aviso de SENAMHI." : " avisos de SENAMHI.") +
            " Una región puede reunir varias estaciones." +
            (additions.length
              ? " Después de ese corte se identificaron otros avisos: " +
                additions.join(", ") +
                "."
              : ""),
        ),
      );
      if (audit.rosterOnly?.length)
        verification.push(
          node(
            "p",
            "Avisos respaldados por el cuadro nacional pendientes de contraste con la ficha individual: " +
              audit.rosterOnly
                .map((id) => String(id).split("-").at(-1))
                .join(", ") +
              ".",
          ),
        );
      verification.push(link("Ver el cuadro de ríos del COEN ↗", audit.url));
    }
    const rows = node("div", "", "coverage-list");
    for (const name of [...counts.keys()].sort((a, b) =>
      a.localeCompare(b, "es"),
    )) {
      const info = regionStatus.get(name),
        description = [];
      if (info.active)
        description.push(
          info.active + (info.active === 1 ? " vigente" : " vigentes"),
        );
      if (info.upcoming)
        description.push(
          info.upcoming + (info.upcoming === 1 ? " próximo" : " próximos"),
        );
      if (info.recent)
        description.push(
          info.recent + (info.recent === 1 ? " reciente" : " recientes"),
        );
      const button = node("button");
      button.append(
        node("strong", regionLabel(name)),
        node("span", description.join(" · ") + " →"),
      );
      button.onclick = () => {
        $("infoDialog").close();
        setRegion(name, true);
        $("regionGo").focus({ preventScroll: true });
      };
      rows.append(button);
    }
    const activeAreas = [...regionStatus].filter(([, s]) => s.active).map(([name]) => regionLabel(name));
    const upcomingAreas = [...regionStatus.values()].filter((s) => s.upcoming).length;
    const recentAreas = [...regionStatus.values()].filter((s) => s.recent).length;
    const countAreas = (n) => n + (n === 1 ? " ámbito" : " ámbitos");
    const distribution = "Avisos vigentes en " + countAreas(activeAreas.length) +
      (activeAreas.length && activeAreas.length <= 4 ? " (" + activeAreas.join(", ") + ")" : "") +
      ". Avisos próximos en " + countAreas(upcomingAreas) +
      ". Reportes de las últimas 72 horas en " + countAreas(recentAreas) + ".";
    const why =
      layer === "mar"
        ? "Hidrografía identifica los tramos con pronóstico de oleaje. El COEN también reporta episodios locales. Toca una zona para consultar el tramo o la localidad y la fecha de cada publicación."
        : "Un pronóstico identifica zonas expuestas. Un reporte de incidente describe lo ocurrido en un lugar concreto. Toca una región para ver qué documento la incluye y cuál es su vigencia.";
    const unlocated = mappedItems.filter(
      (item) => onLayer(item) && !regionNamesFor(item).length,
    );
    const extra = node("details", "", "unlocated");
    if (unlocated.length) {
      extra.append(
        node(
          "summary",
          unlocated.length +
            (unlocated.length === 1
              ? " publicación sin región identificada"
              : " publicaciones sin región identificada"),
        ),
      );
      for (const item of unlocated)
        extra.append(link(item.title + " ↗", item.url));
    }
    dialog(
      "Cobertura de la capa " + layerNames[layer],
      counts.size ? "Regiones con avisos" : "Sin ámbito regional identificado",
      node("p", why),
      ...(counts.size ? [node("p", distribution)] : []),
      ...verification,
      node(
        "p",
        "La vista nacional distingue 26 ámbitos. Lima Provincias, Lima Metropolitana y el Callao se pueden consultar por separado.",
      ),
      ...(delayed.length
        ? [
            node(
              "p",
              "Última consulta pendiente para " +
                delayed.map((s) => s.name).join(", ") +
                ". Se conserva la última lectura disponible." +
                (mappedItems.some(
                  (it) =>
                    onLayer(it) &&
                    (it.originNotice ||
                      it.relatedNotices?.some(
                        (ref) => ref.sourceId === "coen",
                      )),
                )
                  ? " Esta capa también incluye avisos que el COEN reproduce en sus boletines oficiales."
                  : ""),
            ),
          ]
        : []),
      rows,
      ...(unlocated.length ? [extra] : []),
    );
  };
  $("scaleBar").hidden = layer !== "mar";
  $("scales").hidden = layer !== "mar";
  $("mapDetails").textContent =
    layer === "mar"
      ? oceanTime
        ? "NOAA · " +
          dateTime(oceanTime.slice(0, 10)) +
          (oceanProduct === "preliminary" ? " · Preliminar" : "") +
          "  ⓘ"
        : "Información de la capa  ⓘ"
      : "Criterios y fuentes de la capa  ⓘ";
}
$("mapDetails").onclick = () => {
  if(layer==="todo") {
    const forecast=mode==="pronostico";
    dialog("Criterios y fuentes",forecast?"Pronósticos de mar, ríos y lluvias":"Cómo leer los impactos recientes",
      node("p",forecast?"La región se colorea cuando una fuente incluye sectores de su territorio en un pronóstico vigente o próximo. La ficha de cada aviso indica las fechas y el alcance más preciso publicado."
        :"Cada región reúne los reportes de las últimas 24 horas y los avisos hidrológicos que siguen vigentes. La ficha conserva la fecha original de cada medición. Una afectación puede limitarse a la localidad citada. La cantidad de reportes indica la cobertura disponible."),
      node("p",forecast?"Selecciona Lluvias para ver los sectores y niveles de peligro delimitados por SENAMHI."
        :"El impacto grave requiere evidencia reciente de una autoridad o corroboración independiente. Las fichas distinguen daños documentados, hechos reportados, restablecimientos, mediciones y partes operativos."),
      link("Reportes de emergencia del COEN ↗","https://portal.indeci.gob.pe/emergencias/"),
      link("Avisos meteorológicos de SENAMHI ↗","https://www.senamhi.gob.pe/?p=aviso-meteorologico"),
      link("Avisos de oleaje de Hidrografía ↗","https://www.dhn.mil.pe/portal/avisos-especiales"));
    return;
  }
  if (mode==="pronostico" && layer==="lluvias") {
    dialog("Pronóstico","Cómo leer las áreas de peligro",
      node("p","El amarillo, el naranja y el rojo corresponden a los sectores que delimitó SENAMHI en sus archivos para esta edición. El color de fondo de una región indica cobertura de avisos."),
      node("p","Cuando un aviso identifica un distrito con varios niveles, abre su ficha para verlos. La vigencia figura junto al documento."),
      link("Avisos de lluvias de SENAMHI ↗","https://www.senamhi.gob.pe/?p=aviso-24H"),link("Avisos de quebradas ↗","https://www.senamhi.gob.pe/?p=aviso-activacion-quebrada"));return;
  }
  if (mode==="ahora" && layer!=="mar") {
    dialog("Lectura del mapa",layer==="lluvias"?"Lluvia observada e impactos":"Estaciones y reportes de ríos",
      node("p","El punto señala una ubicación publicada o agrupa reportes en la provincia o distrito identificado. La ficha indica la precisión de cada fuente."),
      node("p","La gota identifica una medición. El triángulo rojo exige un impacto grave reciente respaldado por una autoridad o por fuentes independientes. Un umbral de estación describe la medición en ese punto."),
      link("Radar y partes de SENAMHI ↗","https://www.senamhi.gob.pe/?p=reportes-nowcasting-radar"),
      link("Reportes de emergencia del COEN ↗","https://portal.indeci.gob.pe/emergencias/"));
    return;
  }
  const national = mappedItems.filter(
    (i) => onLayer(i) && !regionNamesFor(i).length,
  );
  const shared = [
    node(
      "p",
      "Los contornos destacan regiones mencionadas en avisos oficiales vigentes, próximos o recientes. Consulta el aviso para identificar los sectores concretos.",
    ),
  ];
  if (national.length) {
    shared.push(node("h3", "Avisos sin región identificada"));
    for (const item of national.slice(0, 8))
      shared.push(link(item.title + " ↗", item.url));
  }
  if (layer === "mar") {
    dialog(
      "Cartografía",
      "Anomalía térmica del mar",
      node(
        "p",
        oceanTime
          ? "Observación del " +
              dateTime(oceanTime.slice(0, 10)) +
              ". La escala en °C muestra cuánto difiere la temperatura superficial del mar de su valor de referencia."
          : "La cuadrícula de temperatura no está disponible. El fondo representa el relieve.",
      ),
      node(
        "p",
        oceanProduct === "preliminary"
          ? "La cuadrícula es la edición preliminar del análisis diario NOAA OISST v2.1. NOAA puede revisarla al publicar el producto final. Los límites regionales son orientativos."
          : "La cuadrícula procede del análisis diario final NOAA OISST v2.1. Los límites regionales son orientativos.",
      ),
      link(
        "Abrir la fuente NOAA ↗",
        oceanSource ||
          "https://www.ncei.noaa.gov/products/optimum-interpolation-sst",
      ),
      ...shared,
    );
  } else {
    dialog(
      "Cartografía",
      layer === "rios"
        ? "Reportes sobre ríos"
        : "Reportes de lluvias y quebradas",
      node(
        "p",
        "El color cubre el límite administrativo de la región. El nivel puede variar entre provincias y distritos. Una republicación del COEN cuenta una sola vez cuando identifica el mismo aviso original de SENAMHI.",
      ),
      node(
        "p",
        "Incluimos avisos vigentes o próximos y reportes publicados en las últimas 72 horas sin vigencia definida. Una región sin colorear puede tener incidencias todavía sin registrar.",
      ),
      ...shared,
    );
  }
};
function syncControls() {
  $("regionSelect").value = region;
  $("mapRegion").value = selectedCity ? "ciudad:" + selectedCity : region;
  $("topic").value = topic;
  $("period").value = period;
  if(document.activeElement!==$("searchInput")) $("searchInput").value = query || selectedCity || (ubigeo && catalog?.label(ubigeo)) || "";
  for (const b of document.querySelectorAll("[data-feed]")) {
    const yes = b.dataset.feed === feed;
    b.classList.toggle("selected", yes);
    b.setAttribute("aria-pressed", String(yes));
  }
}
function saveLocation() {
  const url = new URL(location.href);
  const fields = {
    aviso:"",
    region,
    ciudad: selectedCity,
    local: localOnly ? "1" : "",
    capa: layer,
    vista: mode==="ahora" ? "" : mode,
    peligro: mode==="pronostico" && layer==="lluvias" && hazard==="quebradas"?hazard:"",
    ubigeo,
    tema: topic,
    tipo: feed === "oficial" ? "" : feed,
    vigencia: period,
    q: query,
    mapa: fromLayer ? "1" : "",
  };
  for (const [key, value] of Object.entries(fields))
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  if (url.href !== location.href) window.history.replaceState(null, "", url);
}
function changed() {
  limit = 8;
  syncControls();
  syncLayer();
  renderItems();
  saveLocation();
}
function selectedMapTopic() {
  if(layer==="todo")return "";
  if (layer !== "mar") return layer;
  return region && mappedItems.some((it) => inRegion(it, region) && onLayer(it))
    ? layer
    : "";
}
function setRegion(name, viaMap = false, city = "", id = "") {
  const code=mapProvince(id || cityProvinces[city],name);
  ubigeo = code && (!catalog || catalog.regionOf(code)===name) ? code : "";
  selectedCity = "";
  localOnly = false;
  region = knownRegions.includes(name) ? name : "";
  if (viaMap) {
    feed = "oficial";
    query = "";
    period = "";
    topic = selectedMapTopic();
    fromLayer = layer==="todo" || Boolean(topic);
  }
  changed();

}
$("closeRegion").onclick = () => setRegion("", true);
$("regionSelect").onchange = (e) => setRegion(e.target.value);
$("mapRegion").onchange = (e) => {
  const value = e.target.value;
  const city = value.startsWith("ciudad:") && findCity(value.slice(7));
  if(city)setRegion(city.region,true,city.name);
  else navigateArea(value,"");
};
$("mapBack").onclick = () => {
  navigateArea(ubigeo && region!=="Lima Metropolitana"?region:"","");
  if($("mapBack").hidden)$("mapRegion").focus({preventScroll:true});
};
$("topic").onchange = (e) => {
  topic = e.target.value;
  fromLayer = false;
  changed();
};
$("period").onchange = (e) => {
  period = e.target.value;
  changed();
};
const layerSwitch=document.querySelector(".layer-switch");
const layerIndicator=layerSwitch.querySelector(".layer-indicator");
let layerMotion;
function stopLayerSlide() {
  if(layerMotion)layerMotion.cancel();
  layerMotion=null;
  delete layerSwitch.dataset.slideTo;
}
function slideToLayer(button) {
  const previous=layerSwitch.querySelector("[aria-pressed=true]");
  if(!previous || previous===button || !layerIndicator.animate ||
      !matchMedia("(prefers-reduced-motion: no-preference) and (forced-colors: none)").matches)return;
  // A second tap starts from the position currently visible on the screen.
  const from=(layerMotion ? layerIndicator : previous).getBoundingClientRect();
  const to=button.getBoundingClientRect();
  if(!from.width || !to.width)return;
  stopLayerSlide();
  layerIndicator.style.left=button.offsetLeft+"px";
  layerIndicator.style.width=to.width+"px";
  layerSwitch.dataset.slideTo=button.dataset.layer;
  const motion=layerIndicator.animate([
    {transform:"translateX("+(from.left-to.left)+"px) scaleX("+from.width/to.width+")"},
    {transform:"none"},
  ],{duration:180,easing:"cubic-bezier(.2,.7,.3,1)"});
  layerMotion=motion;
  motion.onfinish=()=>{if(layerMotion===motion)stopLayerSlide();};
}
document.querySelectorAll("[data-layer]").forEach(
  (b) =>
    (b.onclick = () => {
      slideToLayer(b);
      layer = b.dataset.layer;
      localOnly = false;
      topic = selectedMapTopic();
      fromLayer = layer==="todo" || Boolean(topic);
      period = "";
      query = "";
      feed = "oficial";
      changed();
    }),
);
document.querySelectorAll("[data-feed]").forEach(
  (b) =>
    (b.onclick = () => {
      feed = b.dataset.feed;
      fromLayer = false;
      changed();
    }),
);
$("clearFilters").onclick = () => {
  query = "";
  selectedCity = "";
  localOnly = false;
  region = "";
  feed = "oficial";
  topic = "";
  period = "";
  fromLayer = false;
  layer = "todo";
  mode="ahora";
  ubigeo="";
  changed();
};
$("more").onclick = () => {
  const shown = limit;
  limit += 12;
  renderItems();
  $("items").children[shown]?.focus({ preventScroll: true });
};
$("queryState").querySelector("button").onclick = () => {
  query = "";
  changed();
};
$("searchForm").onsubmit = (e) => {
  e.preventDefault();
  const q = $("searchInput").value.trim().slice(0, 100);
  if(normalizePlace(q)==="lima") {
    const choices=["Lima Metropolitana","Lima"].map(name=>{
      const button=node("button",regionLabel(name),"place-choice");
      button.onclick=()=>{$("infoDialog").close();navigateArea(name,"");};
      return button;
    });
    dialog("Elegir ubicación","¿Qué parte de Lima quieres consultar?",...choices);
    return;
  }
  const code=catalog?.byId.has(q)?q:placeOptions.get(normalizePlace(q));
  if(code) {
    const loc=catalog.byId.get(code);
    navigateArea(catalog.regionOf(code),loc.id.length>2?loc.id:"");
    $("placeTitle").focus({preventScroll:true});
    return;
  }
  const exact=catalog?.names.get(normalizePlace(q)) || [];
  if(exact.length && !findRegion(q) && !findCity(q)){
    if(exact.length===1){const p=exact[0];navigateArea(catalog.regionOf(p.id),p.id);}
    else {
      const provinces=[...new Set(exact.map(p=>mapProvince(p.id,catalog.regionOf(p.id))))].filter(Boolean);
      if(provinces.length===1){navigateArea(catalog.regionOf(provinces[0]),provinces[0]);return;}
      const choices=provinces.map(id=>{
        const b=node("button","Provincia de "+catalog.label(id),"place-choice");
        b.onclick=()=>{$("infoDialog").close();navigateArea(catalog.regionOf(id),id);};return b;
      });
      dialog("Elegir ubicación","¿En qué provincia buscas "+q+"?",...choices);
    }
    return;
  }
  const match = findRegion(q);
  const city = !match && findCity(q);
  query = match || city ? "" : q;
  topic = "";
  fromLayer = false;
  period = "";
  feed = "oficial";
  setRegion(match || city?.region || "", false, city?.name);
  if (city || match) {
    const locationForMap = new URL(location.href);
    locationForMap.hash = "inicio";
    window.history.replaceState(null, "", locationForMap);
    $("placeTitle").focus({ preventScroll: true });
    return;
  }
  if (location.hash !== "#avisos") location.hash = "avisos";
  else $("avisos").scrollIntoView();
};
$("searchInput").addEventListener("search", () => {
  if (!$("searchInput").value && query) {
    query = "";
    changed();
  }
});
for (const n of knownRegions) {
  $("regionSelect").append(new Option(regionLabel(n), n));
  $("mapRegion").append(new Option(regionLabel(n), n));
  $("places").append(new Option(regionLabel(n), regionLabel(n)));
}
function restoreLocation() {
  const q = new URLSearchParams(location.search);
  region = findRegion(q.get("region"));
  const city = findCity(q.get("ciudad"), region);
  selectedCity = "";
  if (city) region = city.region;
  localOnly = false;
  ubigeo = mapProvince(q.get("ubigeo") || cityProvinces[city?.name],region);
  if(catalog && ubigeo) {
    if(catalog.byId.has(ubigeo)) region=catalog.regionOf(ubigeo);
    else ubigeo="";
  }
  if(catalog && (q.get("ubigeo")!==ubigeo && (ubigeo || q.has("ubigeo")) || city)) {
    const url=new URL(location.href);
    if(ubigeo)url.searchParams.set("ubigeo",ubigeo);else url.searchParams.delete("ubigeo");
    if(region)url.searchParams.set("region",region);
    if(!url.searchParams.has("capa"))url.searchParams.set("capa",initialLayer(q));
    url.searchParams.delete("ciudad");
    url.searchParams.delete("local");
    history.replaceState(history.state,"",url);
  }
  hazard=q.get("peligro")==="quebradas"?"quebradas":"lluvias";
  mode=q.get("vista")==="pronostico"?"pronostico":"ahora";
  layer = initialLayer(q);
  feed = ["todos", "prensa"].includes(q.get("tipo"))
    ? q.get("tipo")
    : "oficial";
  topic = ["agua", "rios", "lluvias", "mar"].includes(q.get("tema"))
    ? q.get("tema")
    : "";
  period = Object.prototype.hasOwnProperty.call(periodNames, q.get("vigencia"))
    ? q.get("vigencia")
    : "";
  fromLayer = q.get("mapa") === "1" && (topic === layer || layer==="todo" && !topic) && feed === "oficial";
  query = (q.get("q") || "").slice(0, 100);
  limit = 8;
  syncControls();
  syncLayer();
  renderItems();
}
const localExplorer=explorer({node,link,dialog,recordDialog,dateTime,showRecord,noticeShare,onPlace:(r,id)=>navigateArea(r,id)});
function navigateArea(r,id) {
  const returnFocus=$("placeTrail").contains(document.activeElement) || document.activeElement===$("areaSelect");
  const old=location.href;
  setRegion(r,true,"",id);
  const updated=location.href;
  if(returnFocus)$("placeTitle").focus({preventScroll:true});
  if(old!==updated){history.replaceState(null,"",old);history.pushState(null,"",updated);}
}
for(const b of document.querySelectorAll("[data-hazard]")) b.onclick=()=>{hazard=b.dataset.hazard;changed();};
for(const b of document.querySelectorAll("[data-view]")) b.onclick=()=>{
  mode=b.dataset.view;
  changed();
};
const placeOptions=new Map();
void loadTerritories().then(index=>{
  territoriesReady=true;
  catalog=index;
  for(const p of index.places.filter(p=>p.id.length===4)) {
    const description=index.label(p.id)+" (provincia)";
    placeOptions.set(normalizePlace(description),p.id);
  }
  updateSuggestions();
  restoreLocation();
}).catch(()=>{territoriesReady=true;}).finally(()=>{void openSharedNotice();});
function updateSuggestions() {
  const q=normalizePlace($("searchInput").value);
  if(!catalog || q.length<2) return;
  const found=[];
  for(const [name,id] of placeOptions)
    if(name.includes(q) || id.startsWith(q)) found.push({id,name,rank:name.startsWith(q)?0:1});
  found.sort((a,b)=>a.rank-b.rank || a.name.localeCompare(b.name,"es"));
  const options=found.slice(0,24).map(({id})=>{
    const value=catalog.label(id)+" (provincia)";
    return new Option(value,value);
  });
  for(const region of knownRegions)if(normalizePlace(region).startsWith(q))options.unshift(new Option(regionTitle(region),regionTitle(region)));
  $("places").replaceChildren(...options);
}
$("searchInput").addEventListener("input",updateSuggestions);
window.addEventListener("popstate", ()=>{
  dialogRequest++;
  leavingNotice=false;
  openedNotice="";
  delete $("infoDialog").dataset.sharedNotice;
  if($("infoDialog").open)$("infoDialog").close();
  restoreLocation();
  void openSharedNotice();
});
restoreLocation();
const fallbackSources = [
  ["COEN · INDECI", "https://portal.indeci.gob.pe/emergencias/"],
  ["ENFEN", enfenUrl],
  ["SENAMHI", "https://www.senamhi.gob.pe/?p=avisos-hidrologicos"],
  [
    "SUNASS",
    "https://aplicaciones.sunass.gob.pe/Interrupciones/consultaInterrupcion.html",
  ],
  ["DHN · Marina", "https://www.dhn.mil.pe/portal/avisos-especiales"],
  ["SUTRAN", "https://alertasviales.sutran.gob.pe/"],
];
function renderSources() {
  const provenance = panel?.publication;
  const triggers = {push:"un cambio publicado", workflow_dispatch:"una solicitud manual", schedule:"el horario de GitHub", rerun:"la repetición de una ejecución anterior"};
  const state = $("publicationStatus");
  if (state) state.hidden = !provenance || !Object.prototype.hasOwnProperty.call(triggers, provenance.event);
  if (state && !state.hidden) {
    const history = "https://github.com/Jccv26/atlas-el-nino-peru/actions/workflows/horario.yml?query=event%3Aschedule";
    state.replaceChildren(document.createTextNode("Esta edición se inició por " + triggers[provenance.event] +
      ". " + (provenance.lastScheduled?.at
        ? "Última consulta iniciada por horario el " + dateTime(provenance.lastScheduled.at) + ". "
        : "La primera consulta por horario está pendiente de verificación. ")),
      link("Ver el registro de actualizaciones automáticas ↗", history));
  }
  const sources =
    panel?.sources ||
    fallbackSources.map(([name, url]) => ({ name, url, status: "external" }));
  const words = {
    ok: "Consulta realizada",
    external: "Consulta en el portal oficial",
    stale: "Se conserva la última lectura",
    error: "Consulta pendiente de recuperación",
  };
  $("sourceList").replaceChildren(
    ...sources.map((s) => {
      const d = node("div", "", "source-row");
      d.dataset.status = s.status;
      d.append(
        link(s.name + " ↗", s.url),
        node(
          "span",
          words[s.status] || "Ver estado en la fuente",
          "source-status",
        ),
      );
      if (s.lastSuccessAt)
        d.append(node("small", "Última lectura: " + dateTime(s.lastSuccessAt)));
      if(s.kind==="prensa") {
        const detail=[s.publisherRegion && "Redacción de "+s.publisherRegion,
          s.intervalMinutes && "Intervalo previsto de consulta · "+s.intervalMinutes+" min"].filter(Boolean);
        if(detail.length)d.append(node("small",detail.join(" · ")));
        const coverage=s.nationalPressCoverage;
        if(coverage && coverage.channelsRead<coverage.totalChannels)
          d.append(node("small","Última lectura parcial · "+coverage.channelsRead+" de "+coverage.totalChannels+" canales del medio."));
      }
      if (s.nowcasting?.observedAt)
        d.append(node("small", "Fecha de la observación en el visor · " + dateTime(s.nowcasting.observedAt)));
      if (s.readChannel === "phisis" || s.readChannel === "web+phisis") {
        d.append(
          node(
            "small",
            s.readChannel === "phisis"
              ? "Lectura recuperada en el listado hidrológico PHISIS de SENAMHI."
              : "Canales oficiales consultados: portal de avisos y listado hidrológico PHISIS de SENAMHI.",
          ),
          link(
            "Abrir visor hidrológico PHISIS ↗",
            "https://www.senamhi.gob.pe/mapas/mapa-aviso-hidro/mapa-aviso-hidro.php",
          ),
        );
      }
      if ((s.status === "error" || s.status === "stale") && s.checkedAt)
        d.append(node("small", "Intento: " + dateTime(s.checkedAt)));
      return d;
    }),
  );
}
let weekly = null;
$("compareHistory").onclick=()=>mostrarHistoria({weekly,node,link,dialog});
const weeklySource = "https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for";
const degree = (number) =>
  (number > 0 ? "+" : "") +
  new Intl.NumberFormat("es-PE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
    .format(number)
    .replace(".", ",");
const fullDate = (day) =>
  new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(day + "T12:00:00Z"));
async function loadWeekly() {
  try {
    const r = await fetch(editionAsset("./data/temperatura.json"), {
      cache: "no-cache",
      signal: globalThis.AbortSignal?.timeout?.(8000),
    });
    if (!r.ok) return;
    const d = await r.json();
    if (
      d.sourceUrl !== weeklySource ||
      !Number.isFinite(d.record?.anomaly) ||
      !Number.isFinite(d.latest?.anomaly) ||
      !Array.isArray(d.record?.dates)
    )
      return;
    const date = fullDate(d.record.date),
      since = fullDate(d.seriesStart);
    $("recordValue").replaceChildren(
      document.createTextNode(degree(d.record.anomaly) + " "),
      node("small", "°C"),
    );
    $("recordDescription").textContent =
      "En la semana centrada en el " +
      date +
      ", la región Niño 1+2 " +
      (d.record.dates.length > 1 ? "igualó" : "alcanzó") +
      " la mayor anomalía semanal de la serie de NOAA, iniciada en " +
      since.slice(-4) +
      ".";
    weekly = d;
  } catch {
    /* The dated, verified observation stays available offline. */
  }
}
$("recordDetails").onclick = () => {
  const parts = [
    node(
      "p",
      "NOAA calcula el promedio de temperatura de la superficie del mar en la región Niño 1+2, frente a Ecuador y el norte del Perú. La anomalía es la diferencia respecto del promedio de esa semana entre 1991 y 2020.",
    ),
  ];
  if (weekly) {
    parts.push(
      node("h3", "Última medición de la serie"),
      node(
        "p",
        "Semana centrada en el " +
          fullDate(weekly.latest.date) +
          " · " +
          degree(weekly.latest.anomaly) +
          " °C sobre la referencia. Temperatura observada: " +
          String(weekly.latest.sst).replace(".", ",") +
          " °C.",
      ),
    );
    parts.push(
      node(
        "p",
        "La serie analizada tiene " +
          new Intl.NumberFormat("es-PE").format(weekly.weeks) +
          " semanas, del " +
          fullDate(weekly.seriesStart) +
          " al " +
          fullDate(weekly.seriesEnd) +
          ".",
      ),
    );
  } else
    parts.push(
      node(
        "p",
        "El dato de portada corresponde a la serie consultada el 26 de noviembre de 2026.",
      ),
    );
  parts.push(
    node(
      "p",
      "El récord describe una semana y una zona del océano. Para evaluar un episodio completo, ENFEN y NOAA también examinan índices de varios meses y la respuesta de la atmósfera.",
    ),
    link("Serie semanal original · NOAA ↗", weeklySource),
    link(
      "Índices y metodología · NOAA ↗",
      "https://www.cpc.ncep.noaa.gov/data/indices/",
    ),
  );
  dialog("Medición observada", "Cómo se mide este récord", ...parts);
};
function updateClimate() {
  const fresh = panel?.items
    ?.filter((i) => i.sourceId === "enfen" && i.publishedAt)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
  if (
    !fresh ||
    Date.parse(fresh.publishedAt) < Date.parse("2026-11-14T00:00:00-05:00")
  )
    return;
  $("magLabel").textContent = "Última actualización de ENFEN";
  $("magnitude").textContent = "Nuevo comunicado";
  $("outlook").textContent = fresh.summary
    ? (
        fresh.summary.match(/^[^.!?]+[.!?](?:\s|$)/u)?.[0] ||
        fresh.summary.slice(0, 190)
      ).trim()
    : fresh.title;
  $("climateSource").textContent =
    "ENFEN · " + dateTime(fresh.publishedAt.slice(0, 10));
  $("climateLink").href = safeUrl(fresh.url) || enfenUrl;
}
function audioText() {
  if (panel?.bulletin?.text) return panel.bulletin.text;
  const take = (panel?.items || [])
    .filter((i) => i.kind === "oficial")
    .slice(0, 3);
  return take.length
    ? "Últimas publicaciones. " +
        take.map((i) => (i.sourceName || i.source) + ". " + i.title).join(". ")
    : "";
}
function resetListening() {
  speaking = false;
  $("listen").textContent = "▷  Boletín nacional";
  $("listen").setAttribute("aria-pressed", "false");
}
function stopAudio() {
  audio?.pause();
  audio = null;
  window.speechSynthesis?.cancel();
  resetListening();
}
$("listen").onclick = async () => {
  if (speaking) {
    stopAudio();
    return;
  }
  const b = panel?.bulletin,
    url = b?.audioUrl;
  const t = audioText();
  if (!t && !url) return;
  const parts = [
    node(
      "p",
      b?.generatedAt
        ? "Edición del " + dateTime(b.generatedAt)
        : "Lectura de las últimas publicaciones oficiales disponibles.",
    ),
    node("p", t),
  ];
  if (url)
    parts.push(
      node(
        "p",
        b.voiceType || "Voz generada por inteligencia artificial.",
        "subtle",
      ),
    );
  else
    parts.push(
      node(
        "p",
        "Lectura con la voz del dispositivo, según disponibilidad.",
        "subtle",
      ),
    );
  if (b?.sources?.length) {
    parts.push(node("h3", "Fuentes de esta edición"));
    for (const source of b.sources) {
      if (!safeUrl(source.url)) continue;
      const reference = node("p", "", "bulletin-source");
      reference.append(
        link(
          (source.sourceName || source.source || "Fuente") + " ↗",
          source.url,
        ),
      );
      if (source.title)
        reference.append(node("span", source.title, "reference-title"));
      const dates = [
        source.publishedAt && "Publicación: " + dateTime(source.publishedAt),
        source.validFrom && "Desde: " + dateTime(source.validFrom),
        source.validUntil && "Hasta: " + dateTime(source.validUntil),
      ].filter(Boolean);
      reference.append(
        node("small", dates.join(" · ") || "Fecha en el documento original"),
      );
      parts.push(reference);
    }
  }
  const play = node("button", "▷  Reproducir", "outline-btn");
  parts.push(play);
  dialog("Boletín nacional", "El Niño hoy en el Perú", ...parts);
  play.onclick = async () => {
    if (speaking) {
      stopAudio();
      play.textContent = "▷  Reproducir";
      return;
    }
    const onEnd = () => {
      resetListening();
      play.textContent = "▷  Reproducir";
    };
    try {
      if (url) {
        const parsed = editionAsset(url.startsWith("/") ? "." + url : url);
        audio = new Audio(parsed.href);
        audio.onended = onEnd;
        audio.onerror = onEnd;
        await audio.play();
      } else if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(t);
        utterance.lang = "es-PE";
        utterance.onend = onEnd;
        utterance.onerror = onEnd;
        window.speechSynthesis.speak(utterance);
      } else {
        play.textContent = "Lectura disponible en texto";
        return;
      }
      speaking = true;
      $("listen").textContent = "■  Detener audio";
      $("listen").setAttribute("aria-pressed", "true");
      play.textContent = "■  Detener";
    } catch {
      onEnd();
      play.textContent = "Audio no disponible";
    }
  };
  play.click();
};
$("infoDialog").addEventListener("close", stopAudio);
function load(forceCheck = false) {
  editionInFlight ??= readEdition(forceCheck).finally(() => {
    editionInFlight = null;
  });
  return editionInFlight;
}
async function readEdition(forceCheck) {
  const paths = location.hostname.endsWith(".github.io")
    ? ["./data/panorama.json"]
    : ["./api/panorama", "./data/panorama.json"];
  for (const path of paths) {
    try {
      const asset=editionAsset(path);
      const staticEdition = path.endsWith(".json");
      // A shared time bucket keeps the published edition discoverable behind Pages' CDN.
      if(staticEdition)asset.searchParams.set("corte",String(Math.floor(Date.now()/(forceCheck?60000:300000))));
      const res = await fetch(asset, {
        cache: "no-cache",
        signal: globalThis.AbortSignal?.timeout?.(staticEdition ? 30000 : 7500),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (
        !Array.isArray(data.items) ||
        !Array.isArray(data.sources) ||
        !data.updatedAt
      )
        continue;
      if(panel && Date.parse(data.updatedAt)<Date.parse(panel.updatedAt)) continue;
      editionReadFailed=false;
      applyVerifiedPressLocations(data);
      mappedItems = layerRecords(data.items);
      panel = data;
      showEditionTime();
      updateClimate();
      renderSources();
      renderItems();
      syncLayer();
      void openSharedNotice();
      // Rendering the notices above the press moves the initial HTML fragment.
      if(initialPressAnchor)requestAnimationFrame(()=>{
        if(initialPressAnchor && location.hash==="#prensa-regional" && !$("infoDialog").open)
          $("prensa-regional").scrollIntoView({block:"start",behavior:"instant"});
        initialPressAnchor=false;
      });
      $("listen").disabled = !audioText() && !data.bulletin?.audioUrl;
      return;
    } catch {}
  }
  editionReadFailed=true;
  if (panel) {showEditionTime(true);syncLayer();renderItems();}
  else {
    $("snapshotTime").textContent =
      "No se pudo consultar el registro. Fuentes oficiales disponibles abajo.";
    renderSources();
    renderItems();
  }
}
function showEditionTime(failed = false) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(panel.updatedAt)) / 60000));
  const status = failed ? " · no se pudo comprobar una edición más reciente" :
    minutes >= 30 ? " · actualización demorada" : "";
  $("snapshotTime").textContent = "Última edición del " + dateTime(panel.updatedAt) + " · hora de Perú" + status;
}
renderSources();
createMap({
  onRegion: (name, city) => navigateArea(name,cityProvinces[city] || ""),
  onArea: id => {const r=catalog?.regionOf(id);if(r)navigateArea(r,id);},
  onGroup: (list,title,r) => r?navigateArea(r,""):localExplorer.group(list,title),
  onOceanReady: (t, s, product) => {
    oceanProduct = product;
    oceanTime = t;
    oceanSource = s;
    syncLayer();
  },
})
  .then((instance) => {
    map = instance;
    syncLayer();
  })
  .catch(() => {
    $("mapDetails").textContent = "Cartografía no disponible  ⓘ";
  });
$("checkEdition").onclick=async e=>{
  const b=e.currentTarget;b.disabled=true;b.textContent="Consultando GitHub…";
  try{await load(true);}
  finally{b.disabled=false;b.textContent="Comprobar última edición";}
};
let lastRefresh = 0;
function refreshPage() {
  if (document.hidden || Date.now() - lastRefresh < 60000) return;
  lastRefresh = Date.now();
  void load();
  void loadWeekly();
  void map?.refreshOcean?.();
}
refreshPage();
setInterval(refreshPage, 5 * 60 * 1000);
setInterval(()=>{if(!document.hidden && panel){showEditionTime(editionReadFailed);syncLayer();}},60000);
document.addEventListener("visibilitychange", refreshPage);
window.addEventListener("online", () => {
  lastRefresh = 0;
  refreshPage();
});
const navLinks = [...document.querySelectorAll(".mast nav a")];
function activeSection() {
  let name = "inicio";
  for (const section of ["avisos", "fuentes"]) {
    if (
      $(section).getBoundingClientRect().top <=
      Math.min(innerHeight * 0.45, 230)
    )
      name = section;
  }
  if (
    name === "inicio" &&
    location.hash === "#avisos" &&
    $("avisos").getBoundingClientRect().top < innerHeight * 0.55
  )
    name = "avisos";
  if (
    location.hash === "#fuentes" &&
    $("fuentes").getBoundingClientRect().top < innerHeight
  )
    name = "fuentes";
  for (const a of navLinks) {
    const active = a.hash === "#" + name;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "location");
    else a.removeAttribute("aria-current");
  }
}
for (const a of navLinks)
  a.addEventListener("click", () => {
    if (a.hash === "#fuentes") $("sourceDetails").open = true;
  });
if (location.hash === "#fuentes") $("sourceDetails").open = true;
let navFrame = false;
window.addEventListener(
  "scroll",
  () => {
    if (!navFrame) {
      navFrame = true;
      requestAnimationFrame(() => {
        activeSection();
        navFrame = false;
      });
    }
  },
  { passive: true },
);
activeSection();
