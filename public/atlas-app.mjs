import { createMap } from "./atlas-map.mjs?v=2";
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
let panel = null,
  layer = "mar",
  feed = "oficial",
  region = "",
  query = "",
  topic = "",
  period = "",
  fromLayer = false,
  limit = 8,
  map = null,
  oceanTime = null,
  oceanProduct = "",
  oceanSource = null,
  requested = 0,
  audio = null,
  speaking = false;
function dateTime(value) {
  if (!value) return "";
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dayOnly ? value + "T12:00:00-05:00" : value);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(dayOnly ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
  }).format(d);
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
function dialog(kind, title, ...content) {
  $("dialogKind").textContent = kind;
  $("dialogTitle").textContent = title;
  $("dialogBody").replaceChildren(...content);
  if (!$("infoDialog").open) $("infoDialog").showModal();
}
$("closeDialog").onclick = () => {
  stopAudio();
  $("infoDialog").close();
};
$("infoDialog").addEventListener("click", (e) => {
  const r = $("infoDialog").getBoundingClientRect();
  if (
    e.target === $("infoDialog") &&
    (e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom)
  )
    $("infoDialog").close();
});
function topics(item) {
  const t = fold((item.category || "") + " " + (item.title || ""));
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
  return Array.isArray(item.regions)
    ? item.regions
    : String(item.region || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
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
};
function validity(item, now = Date.now()) {
  if (item.supersededBy) return "actualizado";
  const start = startOf(item.validFrom),
    end = ending(item.validUntil);
  if (end < now) return "finalizado";
  if (start > now) return "proximo";
  if (start <= now && end >= now) return "vigente";
  return "publicado";
}
function mapPeriod(item) {
  const state = validity(item);
  if (state === "vigente") return "active";
  if (state === "proximo") return "upcoming";
  const age = Date.now() - startOf(eventTime(item));
  return state === "publicado" && age >= 0 && age <= 72 * 3600000
    ? "recent"
    : "";
}
function onLayer(item) {
  if (item.kind !== "oficial" || !mapPeriod(item)) return false;
  if (layer === "mar") return item.sourceId === "marina";
  if (item.sourceId === "coen")
    return layer === "rios"
      ? item.category === "Ríos"
      : ["Lluvias", "Quebradas"].includes(item.category) ||
          (item.category === "Ríos" &&
            /lluvias|precipitaci/.test(fold(item.title)));
  if (!item.sourceId.startsWith("senamhi-")) return false;
  if (layer === "rios") return item.sourceId === "senamhi-rios";
  return (
    ["senamhi-lluvias", "senamhi-quebradas"].includes(item.sourceId) ||
    (item.sourceId === "senamhi-meteo" && topics(item).lluvias)
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
function showRecord(item) {
  const fields = [
    node("p", item.sourceName || item.source || item.sourceId, "record-source"),
  ];
  const dates = [
    item.forecastDate && "Pronóstico para el " + dateTime(item.forecastDate),
    item.publishedAt && "Publicado el " + dateTime(item.publishedAt),
    item.validFrom && "Inicio de vigencia: " + dateTime(item.validFrom),
    item.validUntil && "Fin de vigencia: " + dateTime(item.validUntil),
    item.expectedRestorationAt &&
      "Reposición prevista: " + dateTime(item.expectedRestorationAt),
  ].filter(Boolean);
  if (dates.length) fields.push(node("p", dates.join(" · ")));
  if (places(item).length)
    fields.push(node("p", "Ámbito mencionado: " + places(item).join(", ")));
  if (item.supersededBy)
    fields.push(
      link(
        "Actualizado por el aviso n.º " + item.supersededBy + " ↗",
        item.supersededUrl,
      ),
    );
  const level = levelFor(item, region);
  if (level)
    fields.push(
      node(
        "p",
        level + (region && item.regionLevels?.[region] ? " · " + region : ""),
      ),
    );
  const segments = coastalSegments(item, region);
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
      fields.push(
        node(
          "p",
          "La jurisdicción se identifica por la parte de su litoral comprendida entre los puntos que indica la Marina.",
        ),
        link(
          "Referencia geográfica de los tramos ↗",
          item.coastalMappingSource.url,
        ),
      );
  }
  for (const [i, url] of (item.coverageUrls || []).entries()) {
    if (safeUrl(url))
      fields.push(
        link(
          (["senamhi-lluvias", "senamhi-quebradas"].includes(item.sourceId)
            ? "Visor actual de SENAMHI"
            : "Mapa oficial de cobertura") +
            (item.coverageUrls.length > 1 ? " · " + (i + 1) : "") +
            " ↗",
          url,
        ),
      );
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
  if (item.summary && fold(item.summary) !== fold(item.title))
    fields.push(node("p", item.summary));
  fields.push(link("Abrir publicación original ↗", item.url));
  if (item.kind === "oficial" && (topics(item).lluvias || topics(item).rios))
    fields.push(
      node("h3", "Cómo prepararse"),
      node(
        "p",
        "Revisa con tu comunidad las zonas expuestas, las rutas de evacuación y los puntos de reunión señalados por la autoridad local.",
      ),
      link("Ver la guía oficial de INDECI ↗", prepUrl),
    );
  dialog(
    item.kind === "oficial" ? "Publicación oficial" : "Medios y regiones",
    item.title,
    ...fields,
  );
}
function renderItems() {
  const all = panel?.items || [];
  const list = all.filter(
    (it) =>
      (feed === "todos" ||
        (feed === "oficial" ? it.kind === "oficial" : it.kind !== "oficial")) &&
      (!region || inRegion(it, region)) &&
      (!topic || topics(it)[topic]) &&
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
    ? "Avisos de " + regionLabel(region)
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
  renderRegionCard(all);
}
const layerNames = { mar: "Mar", lluvias: "Lluvias", rios: "Ríos" };
function renderRegionCard(all) {
  $("regionCard").hidden = !region;
  $("mapHint").hidden = !!region;
  $("mapFrame").classList.toggle("has-region", Boolean(region));
  if (!region) return;
  const official = all.filter(
    (it) => it.kind === "oficial" && inRegion(it, region),
  );
  const relevant = official.filter(onLayer);
  const previews = (
    layer === "mar" && !relevant.length ? official : relevant
  ).slice(0, 2);
  $("regionTitle").textContent = regionLabel(region);
  const coverage =
    relevant.length +
    (relevant.length === 1 ? " aviso" : " avisos") +
    " de " +
    (layer === "mar" ? "oleaje" : layerNames[layer].toLowerCase());
  $("regionCount").textContent = panel
    ? coverage + " con ámbito identificado"
    : "Consultando los avisos oficiales…";
  $("regionPreviewLabel").hidden = !(previews.length && !relevant.length);
  $("regionPreview").replaceChildren(
    ...previews.map((it) => {
      const b = node("button", "", "preview-link");
      const coast = it.coastalByRegion?.[region];
      const details = [
        it.source || it.sourceName,
        validity(it) === "publicado" ? "" : periodNames[validity(it)],
        levelFor(it, region),
      ].filter(Boolean);
      b.append(
        node("small", details.join(" · ")),
        node(
          "span",
          coast?.length
            ? coast.map((seg) => seg.stretch).join(" · ")
            : it.title,
        ),
      );
      b.onclick = () => showRecord(it);
      return b;
    }),
  );
  $("regionGo").textContent = relevant.length
    ? "Ver avisos de " +
      (layer === "mar" ? "oleaje" : layerNames[layer].toLowerCase()) +
      " ↓"
    : "Ver avisos de " + regionLabel(region) + " ↓";
  $("otherRegion").hidden = !relevant.length;
  $("otherRegion").onclick = () => {
    topic = "";
    period = "";
    query = "";
    fromLayer = false;
    feed = "oficial";
    changed();
  };
  $("regionGo").onclick = () => {
    query = "";
    period = "";
    feed = "oficial";
    fromLayer = relevant.length > 0;
    topic = fromLayer ? layer : "";
    syncControls();
    renderItems();
    saveLocation();
  };
}
function syncLayer() {
  const counts = new Map(),
    regionTotals = new Map(),
    regionStatus = new Map();
  for (const it of panel?.items || []) {
    const state = onLayer(it) && mapPeriod(it);
    for (const name of regionNamesFor(it)) {
      regionTotals.set(name, (regionTotals.get(name) || 0) + 1);
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
  map?.showLayer(layer, counts, {
    loaded: Boolean(panel),
    regionTotals,
    regionStatus,
  });
  map?.select(region);
  document.querySelectorAll("[data-layer]").forEach((b) => {
    const enable = b.dataset.layer === layer;
    b.classList.toggle("selected", enable);
    b.setAttribute("aria-pressed", String(enable));
  });
  $("legendTitle").textContent =
    layer === "mar"
      ? "Anomalía térmica del mar · °C"
      : layer === "rios"
        ? "Ríos · regiones con reportes"
        : "Lluvias · regiones con reportes";
  $("coverageText").textContent = panel
    ? (counts.size
        ? counts.size +
          (counts.size === 1 ? " zona con avisos" : " zonas con avisos")
        : "Sin regiones identificadas") +
      (layer === "mar" ? " de oleaje" : " en esta capa")
    : "Consultando cobertura…";
  const layerSources =
    layer === "mar"
      ? ["marina"]
      : layer === "rios"
        ? ["coen", "senamhi-rios"]
        : ["coen", "senamhi-lluvias", "senamhi-quebradas", "senamhi-meteo"];
  const delayed = (panel?.sources || []).filter(
    (s) => layerSources.includes(s.id) && ["stale", "error"].includes(s.status),
  );
  if (delayed.length) $("coverageText").textContent += " · lectura parcial";
  $("coverageText").disabled = !panel;
  $("coverageText").onclick = () => {
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
    const why =
      layer === "mar"
        ? "Cada zona tiene litoral dentro de un tramo descrito en un aviso de Hidrografía. Toca una para ver el tramo y el pronóstico de oleaje."
        : "Estas regiones figuran en avisos o reportes oficiales. La zona concreta y los niveles aparecen en cada publicación. Toca una región para consultarlos.";
    const unlocated = (panel.items || []).filter(
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
                ". Se conserva la cobertura publicada anteriormente.",
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
  const national = (panel?.items || []).filter(
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
        "El color cubre el límite administrativo de la región. El nivel puede variar entre provincias y distritos.",
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
  $("mapRegion").value = region;
  $("topic").value = topic;
  $("period").value = period;
  $("searchInput").value = query;
  for (const b of document.querySelectorAll("[data-feed]")) {
    const yes = b.dataset.feed === feed;
    b.classList.toggle("selected", yes);
    b.setAttribute("aria-pressed", String(yes));
  }
}
function saveLocation() {
  const url = new URL(location.href);
  const fields = {
    region,
    capa: layer === "mar" ? "" : layer,
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
function setRegion(name, viaMap = false) {
  region = knownRegions.includes(name) ? name : "";
  if (viaMap) {
    feed = "oficial";
    query = "";
    period = "";
    topic = layer === "mar" ? "" : layer;
    fromLayer = Boolean(topic);
  }
  changed();
}
$("closeRegion").onclick = () => setRegion("", true);
$("regionSelect").onchange = (e) => setRegion(e.target.value);
$("mapRegion").onchange = (e) => setRegion(e.target.value, true);
$("topic").onchange = (e) => {
  topic = e.target.value;
  fromLayer = false;
  changed();
};
$("period").onchange = (e) => {
  period = e.target.value;
  changed();
};
document.querySelectorAll("[data-layer]").forEach(
  (b) =>
    (b.onclick = () => {
      layer = b.dataset.layer;
      topic = layer === "mar" ? "" : layer;
      fromLayer = Boolean(topic);
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
  region = "";
  feed = "oficial";
  topic = "";
  period = "";
  fromLayer = false;
  layer = "mar";
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
  const match = findRegion(q);
  query = match ? "" : q;
  topic = "";
  fromLayer = false;
  period = "";
  feed = "oficial";
  setRegion(match || "");
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
  layer = ["rios", "lluvias"].includes(q.get("capa")) ? q.get("capa") : "mar";
  feed = ["todos", "prensa"].includes(q.get("tipo"))
    ? q.get("tipo")
    : "oficial";
  topic = ["agua", "rios", "lluvias", "mar"].includes(q.get("tema"))
    ? q.get("tema")
    : "";
  period = Object.hasOwn(periodNames, q.get("vigencia"))
    ? q.get("vigencia")
    : "";
  fromLayer = q.get("mapa") === "1" && topic === layer && feed === "oficial";
  query = (q.get("q") || "").slice(0, 100);
  limit = 8;
  syncControls();
  syncLayer();
  renderItems();
}
window.addEventListener("popstate", restoreLocation);
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
      if ((s.status === "error" || s.status === "stale") && s.checkedAt)
        d.append(node("small", "Intento: " + dateTime(s.checkedAt)));
      return d;
    }),
  );
}
let weekly = null;
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
    const r = await fetch("./data/temperatura.json", {
      cache: "no-cache",
      signal: AbortSignal.timeout(8000),
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
        const parsed = new URL(
          url.startsWith("/") ? "." + url : url,
          location.href,
        );
        if (parsed.origin !== location.origin) throw Error("Audio externo");
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
async function load() {
  const run = ++requested;
  const paths = location.hostname.endsWith(".github.io")
    ? ["./data/panorama.json"]
    : ["./api/panorama", "./data/panorama.json"];
  for (const path of paths) {
    try {
      const res = await fetch(path, {
        cache: "no-cache",
        signal: AbortSignal.timeout(7500),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (
        !Array.isArray(data.items) ||
        !Array.isArray(data.sources) ||
        !data.updatedAt
      )
        continue;
      if (run !== requested) return;
      panel = data;
      const age = Date.now() - Date.parse(panel.updatedAt);
      $("snapshotTime").textContent =
        (age > 2 * 3600000
          ? "Último registro disponible: "
          : "Actualización: ") +
        dateTime(panel.updatedAt) +
        " · hora de Perú";
      updateClimate();
      renderSources();
      renderItems();
      syncLayer();
      $("listen").disabled = !audioText() && !data.bulletin?.audioUrl;
      return;
    } catch {}
  }
  if (!panel) {
    $("snapshotTime").textContent =
      "No se pudo consultar el registro. Fuentes oficiales disponibles abajo.";
    renderSources();
    renderItems();
  }
}
renderSources();
createMap({
  onRegion: (name) => setRegion(name, true),
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
