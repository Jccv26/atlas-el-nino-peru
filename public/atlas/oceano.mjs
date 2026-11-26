export const OCEAN_SOURCE =
  "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21NrtAgg_LonPM180.html";
const query = "anom[(last)][(0)][(-25):2:(6)][(-105):2:(-56)]";
export async function fetchOcean({ signal = AbortSignal.timeout(60000) } = {}) {
  const response = await fetch(
    OCEAN_SOURCE.replace(".html", ".csv?") + encodeURIComponent(query),
    { signal },
  );
  if (!response.ok) throw new Error("NOAA " + response.status);
  const lines = (await response.text()).trim().split(/\r?\n/);
  if (lines[0] !== "time,zlev,latitude,longitude,anom")
    throw new Error("Formato NOAA no reconocido");
  const rows = lines.slice(2).map((line) => line.split(","));
  const time = rows[0]?.[0];
  const lats = [...new Set(rows.map((r) => Number(r[2])))].sort(
    (a, b) => b - a,
  );
  const lons = [...new Set(rows.map((r) => Number(r[3])))].sort(
    (a, b) => a - b,
  );
  if (
    !time ||
    !Number.isFinite(Date.parse(time)) ||
    rows.some((r) => r.length !== 5 || r[0] !== time) ||
    lats.length * lons.length !== rows.length ||
    lats.length < 30 ||
    lons.length < 60
  )
    throw new Error("Cuadrícula NOAA incompleta");
  const values = Array(rows.length).fill(null),
    x = new Map(lons.map((v, k) => [v, k])),
    y = new Map(lats.map((v, k) => [v, k]));
  for (const row of rows) {
    const value = Number(row[4]);
    if (Number.isFinite(value) && Math.abs(value) <= 25)
      values[y.get(Number(row[2])) * lons.length + x.get(Number(row[3]))] =
        value;
  }
  if (!values.some(Number.isFinite))
    throw new Error("Cuadrícula NOAA sin observaciones");
  return { time, product: "preliminary", lats, lons, values };
}
