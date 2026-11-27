import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {dailyBulletin,waterRoster} from "./cuadro-rios-coen.mjs";

const site = "https://portal.indeci.gob.pe";
const indexUrl = site + "/informe/informe-de-peligros/";
const parserVersion = 2;
const day = 86400000;
const months =
  "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(
    " ",
  );
const names =
  "Amazonas|Áncash|Apurímac|Arequipa|Ayacucho|Cajamarca|Callao|Cusco|Huancavelica|Huánuco|Ica|Junín|La Libertad|Lambayeque|Lima|Loreto|Madre de Dios|Moquegua|Pasco|Piura|Puno|San Martín|Tacna|Tumbes|Ucayali".split(
    "|",
  );
const fold = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const canonical = new Map(names.map((n) => [fold(n), n]));
const types = {
  "senamhi-lluvias": "Lluvias",
  "senamhi-quebradas": "Quebradas",
  "senamhi-meteo": "Meteorología",
  "senamhi-rios": "Ríos",
};
function family(title) {
  const t = fold(title);
  if (!/boletin informativo de aviso /.test(t)) return;
  if (t.includes("quebrada")) return "senamhi-quebradas";
  if (t.includes("corto plazo") && t.includes("lluvias"))
    return "senamhi-lluvias";
  if (t.includes("aviso meteorologico")) return "senamhi-meteo";
  if (t.includes("aviso hidrologico")) return "senamhi-rios";
}
function decode(text) {
  return text.replace(
    /&(amp|quot|apos|lt|gt|nbsp|#(?:x[\da-f]+|\d+));/gi,
    (all, code) => {
      if (code[0] !== "#")
        return (
          { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[
            code
          ] ?? all
        );
      const n =
        code[1] === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    },
  );
}
function officialUrl(raw, pdf = false) {
  try {
    const url = new URL(decode(raw), site);
    if (
      url.origin !== site ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return;
    if (
      (pdf
        ? /^\/wp-content\/uploads\/20\d{2}\/\d{2}\/[^/]+\.pdf$/i
        : /^\/emergencias\/[\w-]+\/?$/
      ).test(url.pathname)
    )
      return url.href;
  } catch {
    /* An unrecognized link is not a data source. */
  }
}
async function download(url, pdf = false, validators = {}) {
  const maximum = pdf ? 8_000_000 : 650_000;
  const res = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8500),
    headers: validators,
  });
  if (res.status === 304 && pdf) return { unchanged: true };
  const mime = res.headers.get("content-type")?.split(";")[0].trim();
  if (
    !res.ok ||
    mime !== (pdf ? "application/pdf" : "text/html") ||
    Number(res.headers.get("content-length")) > maximum
  ) {
    await res.body?.cancel();
    throw Error("Respuesta de COEN no utilizable");
  }
  const parts = [];
  let bytes = 0;
  for await (const part of res.body) {
    bytes += part.byteLength;
    if (bytes > maximum) throw Error("Documento COEN demasiado grande");
    parts.push(part);
  }
  const body = Buffer.concat(parts, bytes);
  if (pdf && !body.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw Error("PDF no válido");
  return {
    body,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}
function extractPage(pdf, roster = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pdftotext",
      ["-f", "1", "-l", roster ? "80" : "1", roster ? "-layout" : "-bbox-layout", "-enc", "UTF-8", "-", "-"],
      {
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" },
        stdio: ["pipe", "pipe", "ignore"],
        signal: AbortSignal.timeout(5000),
        killSignal: "SIGKILL",
      },
    );
    const chunks = [];
    let size = 0;
    child.on("error", reject);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2_000_000) {
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.stdin.on("error", () => {
      /* Early exits are reported by close. */
    });
    child.once("close", (code) => {
      if (code !== 0 || size > 2_000_000)
        reject(Error("Falló la lectura del PDF"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(pdf);
  });
}
function pageLayout(xml) {
  const coord = (attrs, k) =>
    Number(attrs.match(new RegExp("\\b" + k + '="([.\\d-]+)"'))?.[1]);
  const page = xml.match(/<page\b([^>]*)>/);
  if (!page) throw Error("PDF sin página de texto");
  const blocks = [],
    lines = [];
  for (const b of xml.matchAll(/<block\b[^>]*>([\s\S]*?)<\/block>/g)) {
    const bl = [];
    for (const [, attrs, words] of b[1].matchAll(
      /<line\b([^>]*)>([\s\S]*?)<\/line>/g,
    )) {
      const text = [...words.matchAll(/<word\b[^>]*>([^<]*)<\/word>/g)]
        .map((w) => decode(w[1]))
        .join(" ")
        .normalize("NFC");
      if (!text) continue;
      const line = {
        text,
        x: coord(attrs, "xMin"),
        right: coord(attrs, "xMax"),
        y: (coord(attrs, "yMin") + coord(attrs, "yMax")) / 2,
      };
      bl.push(line);
      lines.push(line);
    }
    if (bl.length) blocks.push(bl);
  }
  return { lines, blocks, width: coord(page[1], "width") };
}
const isoDate = (year, month, dayOfMonth) => {
  const raw = [
    String(year),
    String(month).padStart(2, "0"),
    String(dayOfMonth).padStart(2, "0"),
  ].join("-");
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().startsWith(raw)
    ? raw
    : null;
};
const monthOf = (name) =>
  months.indexOf(fold(name).replace("setiembre", "septiembre")) + 1;
function spanishDate(text) {
  const m = fold(text).match(
    /\b(\d\d?)\s+(?:de\s+)?([a-z]+)\s*,?\s*(?:de(?:l)?\s+)?(20\d\d)\b/,
  );
  return m && monthOf(m[2]) ? isoDate(m[3], monthOf(m[2]), m[1]) : null;
}
function validity(text, issued) {
  const exact = [
    ...text.matchAll(
      /(\d\d?)[-/](\d\d?)[-/](20\d\d)\s*\(\s*(\d\d?:\d\d)\s*h?\s*\)/gi,
    ),
  ];
  if (exact.length === 2) {
    const times = exact.map(([, d, m, y, h]) => {
      const value = isoDate(y, m, d);
      const stamp =
        value && Date.parse(value + "T" + h.padStart(5, "0") + ":00-05:00");
      return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
    });
    if (times[0] && times[1])
      return times[1] >= times[0]
        ? { validFrom: times[0], validUntil: times[1], datePrecision: "minute" }
        : { invalidValidity: true };
    return;
  }
  const match = fold(text).match(
    /(?:desde\s+)?(?:el\s+)?(?:[a-z]+\s+)?(\d{1,2})(?:\s+de\s+([a-z]+))?\s+(?:al|hasta\s+el)\s+(?:[a-z]+\s+)?(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de\s+)?(20\d\d))?/,
  );
  if (!match) return;
  const m1 = monthOf(match[2] || match[4]),
    m2 = monthOf(match[4]);
  if (!m1 || !m2) return;
  const year = Number(issued.slice(0, 4));
  // Resolve a December/January span against the signed publication date.
  const year2 = match[5]
    ? Number(match[5])
    : year + (m2 === 1 && issued.slice(5, 7) === "12" ? 1 : 0);
  const start = isoDate(year2 - (m1 > m2 ? 1 : 0), m1, match[1]),
    end = isoDate(year2, m2, match[3]);
  if (start && end && end >= start)
    return { validFrom: start, validUntil: end, datePrecision: "day" };
}
function exposedTable({ lines, width }) {
  const dep = lines.find((l) => /^DEPARTAMENTOS?$/.test(l.text));
  const prov = lines.find(
    (l) =>
      /^PROVINCIAS? EXPUESTAS?$/i.test(l.text) &&
      dep &&
      Math.abs(l.y - dep.y) < 18,
  );
  if (!dep || !prov || dep.right >= prov.right) return {};
  // Department labels align in their own column, regardless of the number of
  // lines each province cell occupies or the parallel map/narrative.
  const rows = lines
    .filter(
      (l) =>
        l.y > dep.y &&
        l.x >= dep.x - width * 0.09 &&
        l.x < dep.right &&
        l.right < prov.x &&
        canonical.has(fold(l.text)) &&
        l.text === l.text.toUpperCase(),
    )
    .sort((a, b) => a.y - b.y);
  if (!rows.length) return {};
  const provincesByRegion = {};
  const regions = [];
  for (let i = 0; i < rows.length; i++) {
    const entry = rows[i],
      name = canonical.get(fold(entry.text));
    if (regions.includes(name)) continue;
    const minY = i ? (rows[i - 1].y + entry.y) / 2 : dep.y + 2;
    const maxY =
      i + 1 < rows.length
        ? (entry.y + rows[i + 1].y) / 2
        : entry.y + (i ? Math.min(20, (entry.y - rows[i - 1].y) / 2) : 12);
    const words = lines
      .filter((l) => l.x > dep.right && l.y > minY && l.y < maxY)
      .sort((a, b) => a.y - b.y)
      .map((l) => l.text)
      .join(" ");
    let provinces = [];
    if (/^[\p{L}\s,.'’–-]+\.$/u.test(words))
      provinces = words
        .slice(0, -1)
        .split(/,\s*/)
        .map((v) => v.trim())
        .filter(Boolean);
    if (name === "Lima" && provinces.some((v) => fold(v) === "lima")) {
      regions.push("Lima Metropolitana");
      provincesByRegion["Lima Metropolitana"] = ["Lima"];
      provinces = provinces.filter((v) => fold(v) !== "lima");
      if (!provinces.length) continue;
    }
    regions.push(name);
    if (provinces.length) provincesByRegion[name] = provinces;
  }
  return { regions, provincesByRegion };
}
function readReport(xml, title) {
  const layout = pageLayout(xml),
    { blocks, lines } = layout;
  const id = family(title);
  const header = blocks.find(
    (b) =>
      family(b.map((l) => l.text).join(" ")) === id &&
      /INDECI\s*\/\s*COEN/i.test(b.map((l) => l.text).join(" ")),
  );
  const coen = header
    ?.map((l) => l.text)
    .join(" ")
    .match(/\bN\s*[°ºo.]\s*(\d{1,5})\s*[-–]\s*(20\d\d)\s*[-–]/i);
  const titleId = title.match(/\bN[°ºo.]?\s*(\d{1,5})/i)?.[1];
  if (!coen || !titleId || Number(titleId) !== Number(coen[1])) return;
  const issued = spanishDate(
    lines.find((l) => /^Chorrillos,/i.test(l.text))?.text ?? "",
  );
  if (!issued || issued.slice(0, 4) !== coen[2]) return;
  const line = lines.find((l) => /^VIGENCIA\s*:/i.test(l.text));
  const range = line && validity(line.text, issued);
  if (!range) return;
  if (range.invalidValidity)
    return {
      invalidValidity: true,
      publishedAt: issued,
      regions: [],
      region: "",
      category: types[id],
    };
  const starts = Date.parse(range.validFrom),
    ends = Date.parse(range.validUntil);
  if (
    (id!=="senamhi-rios" && ends - starts > 8 * day) ||
    Math.abs(starts - Date.parse(issued)) > 8 * day
  )
    return;

  const daily = id === "senamhi-lluvias" || id === "senamhi-quebradas";
  const sourceBlock = blocks.find((b) =>
    daily
      ? /^Fuente\s*:\s*Aviso\s+N/i.test(b[0].text)
      : /^AVISO\s+N/i.test(b[0].text),
  );
  const lead = sourceBlock?.map((l) => l.text).join(" ");
  const original = lead?.match(
    /\bAviso\s+N\s*[°ºo.]?\s*(\d{1,5})(?:\s*[-/]\s*(20\d\d))?/i,
  );
  if (!original) return;
  const detail = { ...range, publishedAt: issued, category: types[id] };
  const year =
    original[2] ||
    (issued.slice(0, 4) === range.validFrom.slice(0, 4) &&
    !/^20\d\d-01-0[123]$/.test(issued)
      ? coen[2]
      : null);
  if (year) detail.originNotice = { sourceId: id, number: original[1], year };
  if (daily) {
    const table = exposedTable(layout);
    if (!table.regions?.length) return;
    Object.assign(detail, table);
    detail.summary =
      (id === "senamhi-lluvias"
        ? "Lluvias intensas"
        : "Posible activación de quebradas") +
      ". El boletín incluye provincias expuestas de " +
      table.regions.length +
      " territorios.";
  } else if (id === "senamhi-rios") {
    const narrative = blocks
      .map((b) => b.map((l) => l.text).join(" "))
      .find(
        (v) =>
          /\bdepartamento\s+de\b/i.test(v) &&
          /\b(?:estaci[oó]n|r[ií]o)\b/i.test(v),
      );
    if (!narrative) return;
    const after = fold(narrative).split(/departamento\s+de\s+/)[1] ?? "";
    const location = names.find((n) =>
      new RegExp("^" + fold(n) + "\\b").test(after),
    );
    if (!location) return;
    detail.regions = [location];
    detail.summary = narrative.slice(0, 1600);
    const level = fold(narrative).match(
      /\b(?:ubicandose|situandose|encontrandose|manteniendose)\s+en\s+(?:el\s+)?umbral\s+(amarillo|naranja|rojo)\b/,
    );
    if (level) detail.level = level[1].toUpperCase();
    const station = narrative.match(
      /\bestación hidrológica\s+([\p{L}\d .'-]{2,70}?)(?:,|\s+registró)/iu,
    );
    if (station) detail.locality = station[1].trim();
  } else {
    const scopeHeading = /\bdepartamentos (?:expuestos|de posible afectacion)\s*:\s*/;
    const block = blocks
      .map((b) => fold(b.map((l) => l.text).join(" ")))
      .find((text) => scopeHeading.test(text));
    if (!block) return;
    // Periods in “la Prov. Const. del Callao” belong to the jurisdiction name.
    const scope = block.split(scopeHeading)[1].replace(
      /\b(?:la\s+)?prov(?:incia)?\.?\s+const(?:itucional)?\.?\s+del?\s+callao\b/g,
      "callao",
    );
    const labels = scope.split(/\.(?=\s|$)/,1)[0];
    detail.regions = [
      ...new Set(
        labels
          .split(/,|\s+y\s+/)
          .map((label) => canonical.get(label.trim()))
          .filter(Boolean),
      ),
    ];
    const description = blocks
      .find((b) => b.includes(line))
      ?.filter((t) => t !== line)
      .map((l) => l.text)
      .join(" ");
    detail.phenomenon = lead.replace(/^AVISO\s+N[^:]*:\s*/i, "").trim();
    detail.summary = (description || detail.phenomenon).slice(0, 1600);
    if (/precipitaci|lluvia|llovizna|graniz/i.test(detail.phenomenon))
      detail.category = "Lluvias";
  }
  if (!detail.regions.length) return;
  detail.region = detail.regions.join(", ");
  detail.regionOrigin = "pdf-coen";
  return detail;
}
function indexEntries(html) {
  const rows = [];
  for (const [article] of html.matchAll(
    /<article\b[^>]*>[\s\S]*?<\/article>/gi,
  )) {
    const link = article.match(
      /<h3>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!link) continue;
    const title = decode(link[2].replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    const source = family(title) || (dailyBulletin(title) ? "cuadro-rios" : ""),
      url = officialUrl(link[1]);
    if (!source || !url) continue;
    const pdfs = [
      ...new Set(
        [...article.matchAll(/\bhref=["']([^"']+)["']/gi)]
          .map((m) => officialUrl(m[1], true))
          .filter(Boolean),
      ),
    ];
    const date = spanishDate(
      article.match(/<!--\s*<p>([^<]+)<\/p>\s*-->/i)?.[1] ?? "",
    );
    rows.push({
      title,
      url,
      pdfUrl: pdfs.length === 1 ? pdfs[0] : null,
      date,
      source,
    });
  }
  return rows;
}
async function readRoster(entry, previousItems, now) {
  if (!entry?.pdfUrl) return [];
  const old=previousItems.filter(r=>r.rosterListedAt && r.coenDocument?.pdfUrl===entry.pdfUrl &&
    Date.parse(r.rosterListedAt)>=+now-48*3600000);
  const cache=old[0]?.coenDocument;
  if (cache && +now-Date.parse(cache.checkedAt)<3*3600000) return old;
  const http=cache?.etag?{"If-None-Match":cache.etag}:cache?.lastModified?{"If-Modified-Since":cache.lastModified}:{};
  const downloaded=await download(entry.pdfUrl,true,http);
  if (cache && downloaded.unchanged) return old.map(r=>({...r,coenDocument:{...r.coenDocument,checkedAt:now.toISOString()}}));
  if (!downloaded.body) return old;
  const doc={pdfUrl:entry.pdfUrl,parserVersion:1,checkedAt:now.toISOString(),sha256:createHash("sha256").update(downloaded.body).digest("hex"),
    ...(downloaded.etag && {etag:downloaded.etag}),...(downloaded.lastModified && {lastModified:downloaded.lastModified})};
  return waterRoster(await extractPage(downloaded.body,true),entry,doc,now);
}
const fields = [
  "originNotice",
  "phenomenon",
  "validFrom",
  "validUntil",
  "datePrecision",
  "regions",
  "region",
  "provincesByRegion",
  "regionOrigin",
  "summary",
  "category",
  "level",
  "locality",
  "invalidValidity",
  "coverageUrls",
  "coenDocument",
];
function applyPrevious(record, old) {
  if (!old?.coenDocument || old.url !== record.url) return;
  for (const key of fields) if (old[key] !== undefined) record[key] = old[key];
  record.publishedAt ||= old.publishedAt;
}
function attach(record, detail, meta) {
  // A revised edition may remove a previous level, region, or validity.
  const date = record.publishedAt || detail.publishedAt;
  for (const key of fields) delete record[key];
  Object.assign(record, detail, {
    publishedAt: date,
    coverageUrls: [meta.pdfUrl],
    coenDocument: meta,
  });
}
async function getPdfUrl(record) {
  const { body } = await download(record.url);
  const links = [
    ...new Set(
      [
        ...body
          .toString("utf8")
          .matchAll(/<a\b[^>]*href=["']([^"']+\.pdf)["'][^>]*>/gi),
      ]
        .filter(([anchor]) => /\b(?:download|btn-download)\b/i.test(anchor))
        .map((m) => officialUrl(m[1], true))
        .filter(Boolean),
    ),
  ];
  return links.length === 1 ? links[0] : null;
}
// The persisted panorama is the cache. Revalidate active reports by validators,
// carry verified data over outages, and keep the most recent document of each
// family from competing with a burst of single-station hydrological reports.
export async function enriquecerDocumentosCoen(
  records,
  { previousItems = [], now = new Date() } = {},
) {
  const previous = new Map(previousItems.map((i) => [i.url, i]));
  const byUrl = new Map(records.map((r) => [r.url, { ...r }]));
  const candidates = new Map();
  let dailyEntry;
  let next=indexUrl;
  for (let page=1; next && page<=16; page++) {
    let html;
    try { html=(await download(next)).body.toString("utf8"); }
    catch { break; }
    const entries=indexEntries(html);
    for (const entry of entries) {
      if (entry.source==="cuadro-rios") {
        if (!dailyEntry && entry.pdfUrl) dailyEntry=entry;
        continue;
      }
      const old = previous.get(entry.url);
      if (!byUrl.has(entry.url))
        byUrl.set(entry.url, {
          id: "coen:" + entry.url,
          sourceId: "coen",
          source: "COEN · INDECI",
          title: entry.title,
          url: entry.url,
          publishedAt: entry.date || old?.publishedAt || null,
          category: types[entry.source],
          regions: [],
          region: "",
        });
      candidates.set(entry.url, entry.pdfUrl);
    }
    const dated=entries.map(e=>Date.parse(e.date)).filter(Number.isFinite);
    if (dated.some(t=>t < +now-3*day)) break;
    const link=html.match(/<a\b[^>]*class=["']next page-numbers["'][^>]*href=["']([^"']+)["']/i)?.[1];
    const expected=indexUrl+"page/"+(page+1)+"/";
    next=link && decode(link)===expected ? expected : null;
  }
  for (const r of byUrl.values())
    if (family(r.title) && officialUrl(r.url)) {
      applyPrevious(r, previous.get(r.url));
      if (!candidates.has(r.url)) candidates.set(r.url, null);
    }
  const groups = new Map(Object.keys(types).map((k) => [k, []]));
  for (const [url, knownPdf] of candidates) {
    const r = byUrl.get(url),
      old = r.coenDocument;
    const same =
      old?.parserVersion === parserVersion &&
      (!knownPdf || old.pdfUrl === knownPdf);
    const expired =
      Date.parse(old && (r.validUntil || r.publishedAt)) < +now - day;
    if (same && (expired || +now - Date.parse(old.checkedAt) < 6 * 3600000))
      continue;
    if (!old && Date.parse(r.publishedAt) < +now - 7 * day) continue;
    groups.get(family(r.title))?.push({ r, knownPdf });
  }
  // Fetch every newly indexed river bulletin in the current batch. Keep
  // concurrency bounded and continue normal rotation for archive backfill.
  const hydro=groups.get("senamhi-rios");
  const urgent=hydro.filter(({r,knownPdf})=>knownPdf && !r.coenDocument);
  const tasks = [...urgent];
  groups.set("senamhi-rios",hydro.filter(v=>!urgent.includes(v)));
  const limit=tasks.length+8;
  while (tasks.length < limit) {
    const start = tasks.length;
    for (const group of groups.values()) {
      if (group.length && tasks.length < limit) tasks.push(group.shift());
    }
    if (tasks.length === start) break;
  }
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const { r, knownPdf } = tasks[cursor++];
      try {
        const pdfUrl = knownPdf || (await getPdfUrl(r));
        if (!pdfUrl) continue;
        const previousDoc = r.coenDocument;
        const same =
          previousDoc?.parserVersion === parserVersion &&
          previousDoc.pdfUrl === pdfUrl;
        const validators = {};
        if (same && previousDoc.etag)
          validators["If-None-Match"] = previousDoc.etag;
        else if (same && previousDoc.lastModified)
          validators["If-Modified-Since"] = previousDoc.lastModified;
        const file = await download(pdfUrl, true, validators);
        const checkedAt = now.toISOString();
        if (same && file.unchanged) {
          r.coenDocument = { ...previousDoc, checkedAt };
          continue;
        }
        if (!file.body) continue;
        const sha256 = createHash("sha256").update(file.body).digest("hex");
        const meta = {
          pdfUrl,
          parserVersion,
          sha256,
          checkedAt,
          ...(file.etag ? { etag: file.etag } : {}),
          ...(file.lastModified ? { lastModified: file.lastModified } : {}),
        };
        if (same && previousDoc.sha256 === sha256) {
          r.coenDocument = meta;
          continue;
        }
        const detail = readReport(await extractPage(file.body), r.title);
        if (detail) attach(r, detail, meta);
      } catch {
        /* An unavailable attachment must not hide the bulletin or its previous verified details. */
      }
    }
  }
  const [roster]=await Promise.all([readRoster(dailyEntry,previousItems,now).catch(()=>[]),worker(),worker(),worker()]);
  return [...byUrl.values(),...roster];
}
