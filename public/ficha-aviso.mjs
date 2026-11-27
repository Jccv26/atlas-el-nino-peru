// A document may back the chronology, the headline and the recommendation.
// Keep one entry per destination, preserving distinct pages of the same PDF.
export function recordSources(node, link) {
  const references = new Map();
  function add(label, url, detail = "") {
    if (!url) return;
    const anchor = link(label, url);
    if (!anchor.href) return;
    let entry = references.get(anchor.href);
    if (!entry) {
      entry = {anchor, details:new Set()};
      references.set(anchor.href, entry);
    }
    if (detail) entry.details.add(detail);
  }
  function section() {
    if (!references.size) return [];
    const wrap = node("section", "", "record-sources");
    const list = node("ul");
    wrap.append(node("h3", "Fuentes y documentos"), list);
    for (const {anchor,details} of references.values()) {
      const row = node("li");
      row.append(anchor);
      for (const detail of details) row.append(node("small",detail));
      list.append(row);
    }
    return [wrap];
  }
  return {add, section};
}

export function recordDates(rows, node, dateTime) {
  const dates = node("dl", "", "record-dates");
  for (const [label, value] of rows) {
    const formatted = dateTime(value);
    if (!formatted) continue;
    const pair = node("div");
    const stamp = node("time", formatted);
    stamp.dateTime = value;
    const dd = node("dd");
    dd.append(stamp);
    pair.append(node("dt",label),dd);
    dates.append(pair);
  }
  if (!dates.childElementCount) return [];
  const precise = rows.some(([,v])=>typeof v==="string" && v.includes("T"));
  return [node("h3", precise ? "Fechas y horas de Perú" : "Fechas"),dates];
}
