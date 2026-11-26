import { OCEAN_SOURCE } from "./atlas/oceano.mjs";
const svgNS = "http://www.w3.org/2000/svg";
const svg = (tag, props = {}) => {
  const n = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(props)) n.setAttribute(k, v);
  return n;
};
const $ = (id) => document.getElementById(id);
const opt = { credentials: "same-origin" };
const nearest = (n, min, max) => Math.max(min, Math.min(max, n));
const palette = [
  [-4, 49, 140, 177],
  [0, 231, 221, 182],
  [4, 239, 155, 83],
  [8, 184, 78, 62],
];
function color(v) {
  const i = v < 0 ? 0 : v < 4 ? 1 : 2,
    lo = palette[i],
    hi = palette[i + 1],
    f = nearest((v - lo[0]) / (hi[0] - lo[0]), 0, 1);
  return lo.slice(1).map((c, j) => Math.round(c + (hi[j + 1] - c) * f));
}
function thermalTexture(data) {
  const { lons, lats, values } = data,
    w = lons.length,
    h = lats.length,
    mul = 7;
  const canvas = document.createElement("canvas");
  canvas.width = w * mul;
  canvas.height = h * mul;
  const ctx = canvas.getContext("2d"),
    pixels = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const sy = nearest((y + 0.5) / mul - 0.5, 0, h - 1.00001),
      iy = Math.floor(sy),
      fy = sy - iy;
    for (let x = 0; x < canvas.width; x++) {
      const sx = nearest((x + 0.5) / mul - 0.5, 0, w - 1.00001),
        ix = Math.floor(sx),
        fx = sx - ix;
      const sample = [
        [ix, iy, (1 - fx) * (1 - fy)],
        [ix + 1, iy, fx * (1 - fy)],
        [ix, iy + 1, (1 - fx) * fy],
        [ix + 1, iy + 1, fx * fy],
      ];
      let v = 0,
        n = 0;
      for (const [cx, cy, weight] of sample) {
        const a = values[cy * w + cx];
        if (Number.isFinite(a)) {
          v += a * weight;
          n += weight;
        }
      }
      if (n < 0.18) continue;
      v /= n;
      const col = color(v),
        idx = (y * canvas.width + x) * 4;
      const contour = Math.min(v - Math.floor(v), Math.ceil(v) - v);
      const shade = contour < 0.025 ? 1.12 : 1;
      pixels.data[idx] = col[0] * shade;
      pixels.data[idx + 1] = col[1] * shade;
      pixels.data[idx + 2] = col[2] * shade;
      // The low-anomaly background preserves the underlying bathymetric relief.
      pixels.data[idx + 3] = Math.min(255, 85 + Math.abs(v) * 27);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}
const labelData = [
  ["OCÉANO PACÍFICO", -89, -12.5, 0.59, "ocean"],
  ["ECUADOR", -78.3, -1.1, 0.39, "country"],
  ["BRASIL", -65.1, -6.4, 0.37, "country"],
  ["BOLIVIA", -65.4, -16, 0.37, "country"],
  ["COLOMBIA", -71, 1.4, 0.36, "country"],
  ["PERÚ", -74.6, -8.5, 0.58, "nation"],
  ["Piura", -80.62, -5.2, 0.34, "city"],
  ["Iquitos", -73.25, -3.75, 0.34, "city"],
  ["Lima", -77.04, -12.05, 0.36, "city"],
  ["Cusco", -71.97, -13.53, 0.32, "city"],
  ["Arequipa", -71.54, -16.4, 0.31, "city"],
];
export async function createMap({ onRegion, onOceanReady }) {
  const map = $("map"),
    frame = map.parentElement,
    geo = await fetch("./atlas/geografia.json", opt).then((r) => {
      if (!r.ok) throw Error("geografía");
      return r.json();
    });
  geo.land.forEach((l) => {
    $("landMask").append(svg("path", { d: l.d }));
    $("countryLines").append(svg("path", { d: l.d, class: "country-path" }));
  });
  const regions = new Map();
  geo.regions.forEach((r) => {
    const path = svg("path", {
      d: r.d,
      class: "region-path",
      "data-region": r.name,
    });
    const t = svg("title");
    t.textContent = r.name;
    path.append(t);
    $("regions").append(path);
    regions.set(r.name, path);
  });
  labelData.forEach(([label, lon, lat, size, kind]) => {
    if (kind === "city")
      $("mapLabels").append(
        svg("circle", {
          cx: lon + 105,
          cy: 6 - lat,
          r: ".075",
          fill: "#e9e9cb",
          stroke: "#183029",
          "stroke-width": ".03",
        }),
      );
    const t = svg("text", {
      x: lon + 105 + (kind === "city" ? 0.18 : 0),
      y: 6 - lat,
      "font-size": size,
      "text-anchor": kind === "city" ? "start" : "middle",
      class: "map-label",
    });
    if (kind === "ocean") {
      t.style.fill = "#d5e3de";
      t.style.letterSpacing = ".13px";
      t.style.fontStyle = "italic";
      t.style.fontWeight = "400";
    }
    if (kind === "country") {
      t.style.opacity = ".70";
      t.style.letterSpacing = ".08px";
    }
    if (kind === "nation") {
      t.style.letterSpacing = ".19px";
      t.style.opacity = ".82";
    }
    t.textContent = label;
    $("mapLabels").append(t);
  });
  let zoom = 1,
    center = null,
    drag = null,
    skipClick = false,
    selected = "";
  function redraw() {
    const { width, height } = map.getBoundingClientRect(),
      ratio = width / Math.max(1, height),
      h0 =
        width < 761
          ? Math.max(22, 20.7 / ratio)
          : Math.min(22.7, Math.max(20.4, 49 / ratio)),
      h = h0 / zoom,
      w = h * ratio;
    const ref =
      width < 761 ? [31, 15] : [Math.min(49 - w / 2, 45 - w / 2), 14.65];
    const raw = center || ref,
      x = w < 49 ? nearest(raw[0], w / 2, 49 - w / 2) : 24.5,
      y = h < 31 ? nearest(raw[1], h / 2, 31 - h / 2) : 15.5;
    map.setAttribute("viewBox", [x - w / 2, y - h / 2, w, h].join(" "));
    $("zoomIn").disabled = zoom >= 4;
    $("zoomOut").disabled = zoom <= 1;
  }
  const zoomBy = (f) => {
    const b = map.viewBox.baseVal;
    center = [b.x + b.width / 2, b.y + b.height / 2];
    zoom = nearest(zoom * f, 1, 4);
    if (zoom === 1) center = null;
    redraw();
  };
  $("zoomIn").onclick = () => zoomBy(1.5);
  $("zoomOut").onclick = () => zoomBy(1 / 1.5);
  $("resetView").onclick = () => {
    zoom = 1;
    center = null;
    onRegion("");
    redraw();
  };
  new ResizeObserver(redraw).observe(map);
  redraw();
  map.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" && zoom === 1) return;
    const b = map.viewBox.baseVal;
    drag = {
      x: e.clientX,
      y: e.clientY,
      c: [b.x + b.width / 2, b.y + b.height / 2],
      w: b.width,
      moved: false,
    };
  });
  map.addEventListener("pointermove", (e) => {
    if (!drag || !e.buttons) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    map.setPointerCapture(e.pointerId);
    const scale = drag.w / map.clientWidth;
    center = [drag.c[0] - dx * scale, drag.c[1] - dy * scale];
    redraw();
  });
  const endDrag = () => {
    if (drag?.moved) {
      skipClick = true;
      setTimeout(() => (skipClick = false), 120);
    }
    drag = null;
  };
  map.addEventListener("pointerup", endDrag);
  map.addEventListener("pointercancel", endDrag);
  map.addEventListener("click", (e) => {
    const area = e.target.closest("[data-region]");
    if (area && !skipClick) onRegion(area.getAttribute("data-region"));
  });
  fetch("./atlas/oceano.json", opt)
    .then((r) => {
      if (!r.ok) throw Error("océano");
      return r.json();
    })
    .then((data) => {
      const heat = $("thermal"),
        d = Math.abs(data.lons[1] - data.lons[0]);
      for (const [key, value] of Object.entries({
        x: data.lons[0] + 105 - d / 2,
        y: 6 - data.lats[0] - d / 2,
        width: data.lons.length * d,
        height: data.lats.length * d,
        href: thermalTexture(data),
      }))
        heat.setAttribute(key, value);
      onOceanReady(data.time, OCEAN_SOURCE, data.product);
    })
    .catch(() => onOceanReady(null, OCEAN_SOURCE));
  return {
    regionNames: [...regions.keys()].sort((a, b) => a.localeCompare(b, "es")),
    select(name) {
      selected = name;
      regions.forEach((p, n) => p.classList.toggle("focused", n === selected));
    },
    showLayer(layer, counts) {
      $("thermal").style.display = layer === "mar" ? "" : "none";
      regions.forEach((p, n) => {
        let count = counts.get(n) || 0;
        p.style.fill =
          layer !== "mar" && count > 0
            ? layer === "rios"
              ? "#50d9c6a6"
              : "#91b9f3ab"
            : "transparent";
        p.querySelector("title").textContent =
          n +
          (layer === "mar" ? "" : " · " + count + " publicaciones recientes");
      });
    },
  };
}
