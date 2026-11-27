// COEN and SENAMHI have independent numbering. Only the original explicitly
// cited inside a COEN bulletin can link it to a notice in a SENAMHI series.
const families = {
  "senamhi-lluvias": {
    title: /aviso de corto plazo ante lluvias intensas/,
    categories: ["lluvias"],
  },
  "senamhi-quebradas": {
    title: /aviso de corto plazo ante (?:posible )?activacion de quebradas/,
    categories: ["quebradas"],
  },
  "senamhi-rios": { title: /aviso hidrologico/, categories: ["rios"] },
  "senamhi-meteo": {
    title: /aviso meteorologico/,
    categories: ["meteorologia", "lluvias"],
  },
};
const fold = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const number = (n) =>
  /^\d{1,6}$/.test(String(n ?? "")) && Number(n) > 0 ? String(Number(n)) : "";
const year = (y) => (/^(?:19|20)\d{2}$/.test(String(y ?? "")) ? String(y) : "");

function publicationYear(item) {
  // First days of January can refer to an original issued the previous year.
  const value = item.publishedAt || item.validFrom;
  if (!value) return "";
  let day = value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const stamp = Date.parse(value);
    if (!Number.isFinite(stamp)) return "";
    day = new Date(stamp - 5 * 3600000).toISOString().slice(0, 10);
  }
  return /^\d{4}-01-0[1-3]$/.test(day) ? "" : year(day.slice(0, 4));
}
function originalKey(item) {
  if (!item || (item.kind && item.kind !== "oficial")) return "";
  if (item.sourceId === "coen") {
    const ref = item.originNotice;
    const definition =
      ref && Object.hasOwn(families, ref.sourceId) && families[ref.sourceId];
    const title = fold(item.title);
    if (
      !definition ||
      !/^boletin\b/.test(title) ||
      !definition.title.test(title) ||
      !definition.categories.includes(fold(item.category)) ||
      !number(ref.number) ||
      !year(ref.year)
    )
      return "";
    return [ref.sourceId, year(ref.year), number(ref.number)].join("/");
  }
  if (!Object.hasOwn(families, item.sourceId)) return "";
  if (
    item.category &&
    !families[item.sourceId].categories.includes(fold(item.category))
  )
    return "";
  // Current connectors encode the issuer's year and number in their stable ID.
  const id = String(item.id ?? "").match(
    /^(senamhi-(?:lluvias|quebradas|rios|meteo)):(\d{4})-(\d+)$/,
  );
  const n = number(item.noticeNumber) || (id && number(id[3]));
  if (!n || (id && (id[1] !== item.sourceId || number(id[3]) !== n))) return "";
  let y = year(item.noticeYear);
  if (id) {
    if (y && y !== id[2]) return "";
    y = year(id[2]);
  }
  if (!y && item.sourceId === "senamhi-meteo") {
    try {
      const u = new URL(item.url);
      if (u.origin === "https://www.senamhi.gob.pe")
        y = year(u.searchParams.get("a"));
    } catch {
      /* Older records may have no dated URL. */
    }
  }
  y ||= publicationYear(item);
  return y ? [item.sourceId, y, n].join("/") : "";
}
function regionsOf(item) {
  return Array.isArray(item.regions) && item.regions.length
    ? item.regions
    : String(item.region || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
function mergeGroup(members) {
  const original = members.find((m) => m.sourceId !== "coen");
  const primary =
    original ?? members.find((m) => !m.rosterListedAt && regionsOf(m).length) ?? members.find((m) => regionsOf(m).length) ?? members[0];
  if (members.length === 1) return primary;
  const sources = [primary, ...members.filter((m) => m !== primary)];
  const regions = new Map(),
    levels = {},
    provinces = {},
    refs = new Map(),
    documents = new Set();
  for (const m of sources) {
    const areas = regionsOf(m);
    for (const name of areas) {
      const k = fold(name);
      if (!regions.has(k)) regions.set(k, name);
      const canonical = regions.get(k),
        localLevels = m.regionLevels?.[name];
      if (
        !levels[canonical] &&
        Array.isArray(localLevels) &&
        localLevels.length
      )
        levels[canonical] = localLevels;
      const namedProvinces = m.provincesByRegion?.[name];
      if (Array.isArray(namedProvinces) && namedProvinces.length)
        provinces[canonical] = [
          ...new Set([...(provinces[canonical] || []), ...namedProvinces]),
        ];
    }
    for (const url of m.coverageUrls ?? []) documents.add(url);
    if (m.url && !refs.has(m.url)) {
      refs.set(m.url, {
        id: m.id,
        sourceId: m.sourceId,
        source: m.sourceName || m.source,
        title: m.title,
        url: m.url,
        regions: areas,
        ...(m.coenDocument?.pdfUrl
          ? { documentUrl: m.coenDocument.pdfUrl }
          : {}),
      });
    }
  }
  const names = [...regions.values()];
  const result = {
    ...primary,
    regions: names,
    region: names.join(", "),
    relatedNotices: [...refs.values()],
  };
  if (regions.size > new Set(regionsOf(primary).map(fold)).size)
    result.regionOrigin = "fuentes-del-aviso";
  if (documents.size) result.coverageUrls = [...documents];
  if (Object.keys(levels).length) result.regionLevels = levels;
  if (Object.keys(provinces).length) result.provincesByRegion = provinces;
  if (!primary.validFrom && !primary.validUntil) {
    const dated = sources.find((m) => m.validFrom && m.validUntil);
    if (dated)
      Object.assign(result, {
        validFrom: dated.validFrom,
        validUntil: dated.validUntil,
        datePrecision: dated.datePrecision,
      });
  }
  return result;
}

export function layerRecords(items) {
  const groups = new Map(),
    order = [];
  for (const item of items ?? []) {
    const key = originalKey(item);
    if (!key) {
      if (item && !item.supersededBy && !item.withdrawnAt) order.push(item);
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(item);
  }
  const result = [];
  for (const entry of order) {
    if (typeof entry !== "string") {
      result.push(entry);
      continue;
    }
    const group = groups.get(entry);
    const originals = group.filter((m) => m.sourceId !== "coen");
    if (originals.length && originals.every((m) => m.supersededBy || m.withdrawnAt)) continue;
    const usable = group.filter((m) => !m.supersededBy && !m.withdrawnAt && !m.invalidValidity);
    // Multiple distinct originals for one key are ambiguous. Keep them all
    // visible until the issuer's exact identity can be established.
    if (originals.length > 1) result.push(...usable);
    else if (usable.length) result.push(mergeGroup(usable));
  }
  return result;
}
