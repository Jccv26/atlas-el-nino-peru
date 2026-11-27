// INEI UBIGEO keys keep homonymous places in their published administrative scope.
export const normalizePlace = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
export const regionTitle = region => region === "Lima" ? "Lima Provincias" : region;
export function territoryIndex(data) {
  const places = [...data.departments, ...data.provinces, ...data.districts];
  const byId = new Map(places.map(place => [place.id, place]));
  const names = new Map();
  for (const place of places) {
    const key = normalizePlace(place.name);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(place);
  }
  function regionOf(id) {
    if(!byId.has(id))return "";
    return id.startsWith("1501") ? "Lima Metropolitana" : byId.get(id.slice(0,2))?.name || "";
  }
  function department(region) {
    return region === "Lima Metropolitana" || region === "Lima" ? "15" : (names.get(normalizePlace(region)) || []).find(p => p.id.length === 2)?.id;
  }
  function match(name, length, prefix = "") {
    const matches = (names.get(normalizePlace(name)) || []).filter(p => p.id.length === length && p.id.startsWith(prefix));
    return matches.length === 1 ? matches[0].id : "";
  }
  function resolve(region, province, district) {
    const dep = department(region);
    if (!dep) return "";
    const prov = region === "Lima Metropolitana" && !province ? "1501" : match(province,4,dep);
    if(region==="Lima Metropolitana" && prov!=="1501")return "";
    // An explicitly named, unmatched province cannot be silently substituted.
    return (district && (!province || prov) && match(district,6,prov || dep)) || prov || dep;
  }
  function children(region, id = "") {
    if (!region || id.length>=4) return [];
    return data.provinces.filter(p=>regionOf(p.id)===region);
  }
  function label(id) {
    const chain = [id, id.slice(0,4), id.slice(0,2)];
    return [...new Set(chain)].map(code=>byId.get(code)?.name).filter(Boolean).join(" · ");
  }
  return {byId, names, regionOf, resolve, children, department, label, places, provinces:data.provinces};
}
export async function loadTerritories() {
  const res = await fetch(new URL("./atlas/territorios/catalogo.json", import.meta.url));
  if (!res.ok) throw Error("Catálogo territorial no disponible");
  return territoryIndex(await res.json());
}

export function noticeCovers(item, id, index) {
  if (!id || !index) return !id;
  if (Object.keys(item.districtLevels || {}).some(code=>code.startsWith(id))) return true;
  const region = index.regionOf(id);
  if (!region) return false;
  if(item.radarType && item.region===region && index.resolve(region,item.province,item.district).startsWith(id))return true;
  if (item.stationName && item.regions?.includes(region))
    if (index.resolve(region, item.stationProvince, item.stationDistrict).startsWith(id)) return true;
  if (id.length === 4) {
    const named = item.provincesByRegion?.[region] || [];
    return named.some(name => index.resolve(region, name) === id);
  }
  return false;
}
