import { createMap } from "./atlas-map.mjs";
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
const history = {
  1983: [
    "1982–1983",
    "Las lluvias se extendieron a Tumbes y Piura durante los últimos meses de 1982 y continuaron en la costa norte en 1983.",
    "SENAMHI",
    "https://idesep.senamhi.gob.pe/portalidesep/idesep_tema_evento_el_nino_la_nina_nino_82_83.jsp",
  ],
  1998: [
    "1997–1998",
    "El río Ica se desbordó el 29 de enero de 1998. El comparador permite explorar el estado del Pacífico en octubre de 1997 frente a octubre de 2026.",
    "INEI",
    "https://proyectos.inei.gob.pe/web/biblioineipub/bancopub/est/lib0270/sub12.htm",
  ],
  2017: [
    "Niño costero de 2017",
    "El 27 de marzo de 2017 se desbordó el río Piura. ENFEN describe este episodio como un evento de características costeras locales.",
    "INDECI",
    "https://portal.indeci.gob.pe/wp-content/uploads/2019/01/20171221162233.pdf",
  ],
  2026: [
    "Episodio de 2026",
    "El comunicado del 13 de noviembre proyectó que la magnitud extraordinaria del calentamiento costero se mantendría hasta febrero de 2027. Consulta las actualizaciones de ENFEN.",
    "ENFEN",
    enfenUrl,
  ],
};
let panel = null,
  layer = "mar",
  feed = "oficial",
  region = "",
  query = "",
  topic = "",
  limit = 12,
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
function internal(text, href) {
  const a = node("a", text);
  a.href = href;
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
  return places(item).some((v) => fold(v) === fold(name));
}
function recent(item) {
  const d = eventTime(item),
    t = d ? ending(d) : NaN;
  return (
    item.kind === "oficial" &&
    Number.isFinite(t) &&
    t <= Date.now() + 86400000 &&
    (item.validUntil
      ? ending(item.validUntil) >= Date.now()
      : t >= Date.now() - 72 * 3600000)
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
  if (item.level)
    fields.push(node("p", "Nivel informado por la fuente: " + item.level));
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
      (!query ||
        fold(
          [it.title, it.summary, it.sourceName, it.category, ...places(it)]
            .filter(Boolean)
            .join(" "),
        ).includes(fold(query))),
  );
  $("listCount").textContent = panel
    ? list.length +
      " " +
      (list.length === 1 ? "publicación" : "publicaciones") +
      (region ? " · " + region : "")
    : "";
  $("items").replaceChildren();
  if (!list.length) {
    $("items").append(
      node(
        "p",
        panel
          ? "No hay publicaciones en esta selección. Consulta las fuentes o amplía los filtros."
          : "La consulta está pendiente. Puedes abrir las fuentes oficiales desde sus enlaces.",
        "empty",
      ),
    );
  }
  for (const item of list.slice(0, limit)) {
    const b = node("button", "", "item");
    b.type = "button";
    const src = node("span", "", "item-source");
    src.append(
      node("span", item.sourceName || item.source || item.sourceId),
      node("span", item.category || "Publicación", "tag"),
    );
    const stat =
      item.validUntil && ending(item.validUntil) < Date.now()
        ? " · Vigencia terminada"
        : "";
    b.append(
      src,
      node("b", item.title),
      node(
        "span",
        (item.forecastDate
          ? "Pronóstico del " + dateTime(item.forecastDate)
          : dateTime(eventTime(item)) || "Ver fecha en la fuente") + stat,
        "meta",
      ),
      node("span", "↗", "arrow"),
    );
    b.onclick = () => showRecord(item);
    $("items").append(b);
  }
  $("more").hidden = list.length <= limit;
  $("queryState").hidden = !query;
  $("queryState").querySelector("span").textContent = "Búsqueda: " + query;
  if (region) {
    const allHere = all.filter(
      (it) =>
        inRegion(it, region) &&
        (layer === "mar" || (recent(it) && topics(it)[layer])),
    );
    $("regionTitle").textContent = region;
    $("regionCount").textContent =
      allHere.length +
      " " +
      (allHere.length === 1
        ? "publicación asociada"
        : "publicaciones asociadas") +
      (layer === "mar" ? " en el registro." : " a esta capa.");
  }
}
function syncLayer() {
  const counts = new Map();
  if (layer !== "mar")
    for (const it of panel?.items || [])
      if (recent(it) && topics(it)[layer])
        for (const p of new Set(places(it)))
          counts.set(p, (counts.get(p) || 0) + 1);
  map?.showLayer(layer, counts);
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
      : "Publicación regional reciente  ⓘ";
}
$("mapDetails").onclick = () => {
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
    );
  } else {
    dialog(
      "Cartografía",
      layer === "rios"
        ? "Reportes sobre ríos"
        : "Reportes de lluvias y quebradas",
      node(
        "p",
        "Un área resaltada indica que una fuente oficial menciona esa región en un reporte reciente o con vigencia abierta. El color cubre el ámbito administrativo; consulta la publicación para conocer las localidades afectadas.",
      ),
      node(
        "p",
        "Incluimos reportes con vigencia conocida o publicados en las últimas 72 horas. Un área sin color puede tener incidencias todavía sin registrar.",
      ),
    );
  }
};
function setRegion(n) {
  region = n;
  $("regionSelect").value = n;
  $("regionCard").hidden = !n;
  limit = 12;
  map?.select(n);
  renderItems();
}
$("closeRegion").onclick = () => setRegion("");
$("regionSelect").onchange = (e) => setRegion(e.target.value);
$("topic").onchange = (e) => {
  topic = e.target.value;
  limit = 12;
  renderItems();
};
document.querySelectorAll("[data-layer]").forEach(
  (b) =>
    (b.onclick = () => {
      layer = b.dataset.layer;
      topic = layer === "mar" ? "" : layer;
      $("topic").value = topic;
      limit = 12;
      syncLayer();
      renderItems();
    }),
);
document.querySelectorAll("[data-feed]").forEach(
  (b) =>
    (b.onclick = () => {
      feed = b.dataset.feed;
      limit = 12;
      document.querySelectorAll("[data-feed]").forEach((k) => {
        const yes = k === b;
        k.classList.toggle("selected", yes);
        k.setAttribute("aria-pressed", String(yes));
      });
      renderItems();
    }),
);
$("more").onclick = () => {
  limit += 15;
  renderItems();
};
$("queryState").querySelector("button").onclick = () => {
  query = "";
  $("searchInput").value = "";
  renderItems();
};
$("searchForm").onsubmit = (e) => {
  e.preventDefault();
  const q = $("searchInput").value.trim(),
    match = knownRegions.find((n) => fold(n) === fold(q));
  query = match ? "" : q;
  topic = "";
  $("topic").value = "";
  setRegion(match || "");
  $("avisos").scrollIntoView();
};
for (const n of knownRegions) {
  $("regionSelect").append(new Option(n, n));
  $("places").append(new Option(n, n));
}
document.querySelectorAll("[data-year]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-year]")
        .forEach((k) => k.classList.toggle("chosen", k === b));
      const [title, body, issuer, url] = history[b.dataset.year];
      dialog(
        "Memoria de El Niño",
        title,
        node("p", body),
        link("Consultar " + issuer + " ↗", url),
        internal("Explorar el comparador →", "./historia.html"),
      );
    }),
);
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
      if (s.status === "error" && s.checkedAt)
        d.append(node("small", "Intento: " + dateTime(s.checkedAt)));
      return d;
    }),
  );
}
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
  $("outlook").textContent = fresh.title;
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
  $("listen").textContent = "▷  Escuchar resumen";
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
  dialog("Resumen de voz", "Escuchar el panorama", ...parts);
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
  onRegion: setRegion,
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
load();
setInterval(
  () => {
    if (!document.hidden) load();
  },
  5 * 60 * 1000,
);
document.querySelector('a[href="#fuentes"]').addEventListener("click", () => {
  $("sourceDetails").open = true;
});
