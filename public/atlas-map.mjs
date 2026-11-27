import { OCEAN_SOURCE } from "./atlas/oceano.mjs";
import {localMap} from "./mapa-local.mjs?v=6";
import {combinedLabels} from "./capa-todo.mjs?v=2";
import {editionAsset} from "./publicacion.mjs";
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
  ["Piura", -80.62, -5.2, 0.34, "city", "Piura"],
  ["Iquitos", -73.25, -3.75, 0.34, "city", "Loreto"],
  ["Lima", -77.04, -12.05, 0.36, "city", "Lima Metropolitana"],
  ["Cusco", -71.97, -13.53, 0.32, "city", "Cusco"],
  ["Arequipa", -71.54, -16.4, 0.31, "city", "Arequipa"],
];
export const mapCities = labelData
  .filter((label) => label[4] === "city")
  .map(([name, lon, lat, , , region]) => ({
    name,
    region,
    x: lon + 105,
    y: 6 - lat,
  }));
// Keep the camera in geographic coordinates. The overlay marks remain the same
// size in screen pixels as the user moves between national and regional views.
export function createCamera(map, onDraw) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const maxZoom = 28;
  let width,
    height,
    baseHeight,
    home,
    state,
    goal,
    framing,
    animation = 0;
  function draw(next) {
    const h = baseHeight / next.z,
      w = (h * width) / height;
    const x = w >= 49 ? 24.5 : nearest(next.x, w / 2, 49 - w / 2);
    const y = h >= 31 ? 15.5 : nearest(next.y, h / 2, 31 - h / 2);
    state = { x, y, z: next.z };
    map.setAttribute("viewBox", [x - w / 2, y - h / 2, w, h].join(" "));
    map.classList.toggle("map-zoomed", next.z > 1.02);
    map.classList.toggle("atlas-detail-view", next.z >= 4);
    const mask = $("seaMask");
    if (mask?.setAttribute) {
      // Limit the intermediate thermal mask to the screen at every zoom level.
      for (const [name,value] of [["x",x-w/2],["y",y-h/2],["width",w],["height",h]])
        mask.setAttribute(name,value);
    }
    onDraw(w / width);
  }
  function stop() {
    cancelAnimationFrame(animation);
    animation = 0;
    goal = null;
    framing = null;
  }
  function move(next, animate = true, frame = null) {
    stop();
    goal = next;
    framing = frame;
    if (!animate || reducedMotion.matches) {
      draw(next);
      return;
    }
    const start = { ...state },
      startTime = performance.now();
    const duration = frame?.local ? 330 : 400;
    function tick(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      draw({
        x: start.x + (next.x - start.x) * ease,
        y: start.y + (next.y - start.y) * ease,
        z: start.z * (next.z / start.z) ** ease,
      });
      if (t < 1) animation = requestAnimationFrame(tick);
      else animation = 0;
    }
    animation = requestAnimationFrame(tick);
  }
  function fitDestination({box,local}) {
    const available = local ? 0.55 : 0.68;
    const z = nearest(
      Math.min(
        (((baseHeight * width) / height) * available) / Math.max(0.015, box.width),
        (baseHeight * (local?0.50:0.62)) / Math.max(0.015, box.height),
      ), 1.3, local ? maxZoom : 12,
    );
    return {x:box.x+box.width/2, y:box.y+box.height/2, z};
  }
  function resize() {
    const box = map.getBoundingClientRect();
    if (!box.height || !box.width) return;
    if (width === box.width && height === box.height) return;
    const frame = framing;
    const target = animation ? goal : state;
    width = box.width;
    height = box.height;
    const ratio = width / height;
    // Frame the national boundary (roughly 13 by 18.4 map units) with
    // room for the map controls in both orientations.
    baseHeight = Math.max(20.9, 17.3 / ratio);
    const perPixel=baseHeight/height;
    const roomToEast=30.3+baseHeight*ratio/2-36.357-12*perPixel;
    const shiftWest=ratio<1 ? Math.max(0,Math.min(28*perPixel,roomToEast)) : 0;
    home = {
      x: 30.3-shiftWest,
      y: 15.1,
      z: 1,
    };
    // A rotation can arrive mid-flight. Refit the selected territory for the
    // new aspect ratio before the next draw.
    const destination = frame ? fitDestination(frame) : target?.z > 1.01 ? target : home;
    move(destination, false, frame);
  }
  new ResizeObserver(resize).observe(map);
  resize();
  reducedMotion.addEventListener("change", () => {
    if (animation && goal && reducedMotion.matches) move(goal, false, framing);
  });
  return {
    home: () => move(home),
    stop,
    snapshot: () => ({ ...state, scale: baseHeight / (state.z * height) }),
    reveal(point) {
      const view = map.viewBox.baseVal;
      if (
        Math.abs(point.x - state.x) > view.width * 0.43 ||
        Math.abs(point.y - state.y) > view.height * 0.39
      )
        move({ x: point.x, y: point.y, z: Math.min(state.z, 3) });
    },
    fit(box, local = false) {
      const frame = {box,local};
      move(fitDestination(frame), true, frame);
    },
  };
}

function regionAnchor(path) {
  const b = path.getBBox();
  // An inland anchor also works for concave shapes and regions with islands.
  for (const dx of [0.5, 0.35, 0.65, 0.2, 0.8])
    for (const dy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const p = new DOMPoint(b.x + dx * b.width, b.y + dy * b.height);
      if (path.isPointInFill(p)) return p;
    }
  return new DOMPoint(b.x + b.width / 2, b.y + b.height / 2);
}
function regionLabel(name) {
  return name === "Lima" ? "Lima Provincias" : name;
}
function regionPicker(frame, names, choose) {
  const wrap = frame.querySelector(".map-scope");
  if (!wrap) return null;
  wrap.classList.add("atlas-picker");
  const visible = document.createElement("span");
  visible.textContent = "Explorar regiones";
  const existing = wrap.querySelector("select");
  const select = existing || document.createElement("select");
  select.classList.add("atlas-region-picker");
  if (!existing) {
    select.setAttribute("aria-label", "Explorar las regiones del mapa");
    select.append(
      new Option("Todo el Perú", ""),
      ...names.map((n) => new Option(regionLabel(n), n)),
    );
    select.addEventListener("change", () => choose(select.value));
  }
  const icon = svg("svg", {
    viewBox: "0 0 20 20",
    width: 16,
    height: 16,
    "aria-hidden": "true",
  });
  icon.append(
    svg("path", {
      d: "M10 17s5.5-5.6 5.5-10a5.5 5.5 0 1 0-11 0c0 4.4 5.5 10 5.5 10z M12 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.4,
    }),
  );
  const arrow = document.createElement("span");
  arrow.className = "atlas-chevron";
  arrow.setAttribute("aria-hidden", "true");
  wrap.replaceChildren(icon, visible, arrow, select);
  return (name, city) => {
    select.value = city ? "ciudad:" + city : name;
    visible.textContent = city || regionLabel(name) || "Explorar regiones";
  };
}

const coast = new Set([
  "Tumbes",
  "Piura",
  "Lambayeque",
  "La Libertad",
  "Áncash",
  "Lima",
  "Lima Metropolitana",
  "Callao",
  "Ica",
  "Arequipa",
  "Moquegua",
  "Tacna",
]);
const temperature = new Intl.NumberFormat("es-PE", {
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const dateOfGrid = new Intl.DateTimeFormat("es-PE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
function validOceanGrid(data) {
  if (!data || !Number.isFinite(Date.parse(data.time))) return false;
  const { lons, lats, values } = data;
  const regularAxis = (axis, direction) => {
    if (!Array.isArray(axis) || axis.length < 2) return false;
    const step = axis[1] - axis[0];
    return (
      step * direction > 0 &&
      axis.every(
        (coordinate, i) =>
          Number.isFinite(coordinate) &&
          Math.abs(coordinate - (axis[0] + i * step)) < 0.000001,
      )
    );
  };
  return (
    regularAxis(lons, 1) &&
    regularAxis(lats, -1) &&
    Array.isArray(values) &&
    values.length === lons.length * lats.length &&
    values.every((value) => value === null || Number.isFinite(value)) &&
    values.some(Number.isFinite)
  );
}

function oceanCell(grid, point) {
  if (!grid) return null;
  const { lons, lats, values } = grid;
  const col = Math.round((point.x - 105 - lons[0]) / (lons[1] - lons[0]));
  const row = Math.round((6 - point.y - lats[0]) / (lats[1] - lats[0]));
  if (col < 0 || col >= lons.length || row < 0 || row >= lats.length)
    return null;
  const value = values[row * lons.length + col];
  if (!Number.isFinite(value)) return null;
  return { x: lons[col] + 105, y: 6 - lats[row], value };
}
export async function createMap({ onRegion, onOceanReady, onArea, onGroup }) {
  const map = $("map"),
    frame = map.parentElement,
    geo = await fetch("./atlas/geografia.json?v=2", opt).then((r) => {
      if (!r.ok) throw Error("geografía");
      return r.json();
    });
  geo.land.forEach((l) => {
    $("landMask").append(svg("path", { d: l.d }));
    $("countryLines").append(svg("path", { d: l.d, class: "country-path" }));
    if (l.name === "Peru") {
      const outline=svg("g",{class:"peru-outline","aria-hidden":"true","pointer-events":"none"});
      for(const kind of ["casing","edge"])
        outline.append(svg("path",{d:l.d,class:kind,"fill":"none","vector-effect":"non-scaling-stroke"}));
      $("mapWorld").insertBefore(outline,$("mapLabels"));
    }
  });
  const regions = new Map();
  const names = geo.regions
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b, "es"));
  const anchors = new Map();
  const clearance = new Map();
  const regionGroup = $("regions");
  const nationalBoundaries = svg("path", {
    d: geo.regions.map(region => region.d).join(" "),
    class: "region-casing",
    fill: "none",
    "vector-effect": "non-scaling-stroke",
    "aria-hidden": "true",
    "pointer-events": "none",
  });
  regionGroup.before(nationalBoundaries);
  regionGroup.setAttribute("role", "group");
  regionGroup.setAttribute("aria-label", "Regiones del Perú");
  const help = document.createElement("p");
  help.id = "atlas-map-keys";
  help.className = "atlas-sr";
  help.textContent =
    "Usa las flechas para recorrer las regiones por orden alfabético. Pulsa Intro para acercar y abrir su ficha, o Escape para volver a todo el Perú.";
  frame.append(help);
  geo.regions.forEach((r, i) => {
    const path = svg("path", {
      id: "atlas-region-" + i,
      d: r.d,
      class: "region-path",
      "data-region": r.name,
      role: "button",
      tabindex: r.name === names[0] ? 0 : -1,
      "aria-pressed": "false",
      "aria-controls": "regionCard",
      "aria-describedby": help.id,
      "aria-label": regionLabel(r.name),
    });
    regionGroup.append(path);
    regions.set(r.name, path);
    if (r.labelCircle) {
      const [x,y,radius]=r.labelCircle;
      anchors.set(r.name,new DOMPoint(x,y));
      clearance.set(r.name,radius);
    } else anchors.set(r.name, regionAnchor(path));
  });
  const impactRows=$("nationalImpactRows");
  let previewed;
  function previewRegion(target) {
    const row=target?.closest?.("button[data-region]");
    const next=impactRows.contains(row) ? regions.get(row?.dataset.region) : null;
    if(previewed===next)return;
    previewed?.classList.remove("region-from-list");
    next?.classList.add("region-from-list");
    previewed=next;
  }
  impactRows.addEventListener("focusin",e=>previewRegion(e.target));
  impactRows.addEventListener("focusout",e=>previewRegion(e.relatedTarget));
  impactRows.addEventListener("pointerover",e=>{if(e.pointerType==="mouse")previewRegion(e.target);});
  impactRows.addEventListener("pointerleave",()=>previewRegion(document.activeElement));
  labelData.forEach(([label, lon, lat, size, kind, region]) => {
    const group =
      kind === "city"
        ? svg("g", {
            class: "map-city",
            "data-city": label,
            "data-region": region,
            role: "button",
            tabindex: "0",
            "aria-label": "Ciudad de " + label + ", " + regionLabel(region),
            "aria-controls": "regionCard",
          })
        : $("mapLabels");
    if (kind === "city")
      group.append(
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
      x: lon + 105,
      y: 6 - lat,
      "font-size": size,
      "text-anchor": kind === "city" ? (label === "Lima" ? "end" : "start") : "middle",
      class: "map-label " + kind,
    });
    t.style.setProperty(
      "--atlas-label-px",
      kind === "city" ? 11 : kind === "nation" ? 17 : 13,
    );
    if (kind === "ocean") {
      t.setAttribute("text-anchor","start");
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
    if (kind !== "city") t.setAttribute("aria-hidden", "true");
    group.append(t);
    if (kind === "city") $("mapLabels").append(group);
  });
  $("mapLabels").setAttribute("pointer-events", "none");
  $("mapLabels").setAttribute("role", "group");
  $("mapLabels").setAttribute("aria-label", "Ciudades del mapa");
  const art = svg("g", { class: "atlas-annotations", "aria-hidden": "true" });
  $("mapWorld").append(art);
  const outline = svg("path", { class: "atlas-outline", visibility: "hidden" });
  const marker = svg("g", { class: "atlas-marker", visibility: "hidden" });
  marker.append(
    svg("circle", { r: 9, class: "atlas-marker-halo" }),
    svg("circle", { r: 4, class: "atlas-marker-dot" }),
  );
  const markerText = svg("text", { x: 15, y: 4, class: "atlas-marker-label" });
  marker.append(markerText);
  // Give adjacent small territories distinct touch targets without enlarging
  // their geographic polygons or swallowing taps on neighboring regions.
  function cityTag(name, label, x, y, width) {
    const group = svg("g", { "data-region": name, class: "atlas-callao" });
    const left = x < 0 ? x - width : x;
    const text = svg("text", {
      x: left + width / 2,
      y: y + 4,
      "text-anchor": "middle",
    });
    text.textContent = label;
    group.append(
      svg("circle", { r: 2.5, class: "atlas-callao-dot" }),
      svg("path", { d: "M0 0 L" + x + " " + y, class: "atlas-callao-line" }),
      svg("rect", {
        x: left,
        y: y - 11,
        width,
        height: 22,
        rx: 7,
        class: "atlas-callao-tag",
      }),
      text,
      svg("rect", {
        x: left,
        y: y - 22,
        width,
        height: 44,
        fill: "transparent",
        "pointer-events": "all",
      }),
    );
    return {name,group};
  }
  const compactTags = [
    // Both touch targets sit offshore, clear of the inland regions and Lima city.
    cityTag("Callao", "Callao", -27, -20, 46),
    cityTag("Lima Metropolitana", "Lima Metropolitana", -15, 27, 99),
  ];
  const sampleMark = svg("g", {
    class: "atlas-ocean-sample",
    visibility: "hidden",
  });
  sampleMark.append(
    svg("circle", { r: 4.5 }),
    svg("path", { d: "M-8 0h3 M5 0h3 M0 -8v3 M0 5v3" }),
  );
  art.append(
    outline,
    marker,
    ...compactTags.map((tag) => tag.group),
    sampleMark,
  );

  const tip = document.createElement("div");
  tip.className = "atlas-map-tip";
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");
  const tipTitle = document.createElement("strong"),
    tipInfo = document.createElement("span");
  tip.append(tipTitle, tipInfo);
  frame.append(tip);
  const announce = document.createElement("span");
  announce.className = "atlas-sr";
  announce.setAttribute("role", "status");
  frame.append(announce);
  const updatePicker = regionPicker(frame, names, onRegion);
  let selected = "",
    selectedCity = "",
    hover = "",
    tabRegion = names[0],
    layer = "mar",
    grid = null,
    sample = null;
  let counts = new Map(),
    states = null,
    regionMarks = null,
    upcoming = null,
    loaded = false,
    drag = null,
    skipClick = false;
  let unit = 1,
    activeTip = "",
    keyboardRegion = "";
  function pin(el, point) {
    el.setAttribute(
      "transform",
      "translate(" + point.x + " " + point.y + ") scale(" + unit + ")",
    );
  }
  let localOverlay;
  const oceanLabel=map.querySelector(".map-label.ocean");
  function paintMarks(nextUnit) {
    unit = nextUnit;
    if (!selected && !map.classList.contains("map-zoomed")) {
      const view=map.viewBox.baseVal;
      const size=Math.min(16,Math.max(9,view.width/unit*.026));
      oceanLabel.setAttribute("x",Math.max(12,view.x+12*unit));
      oceanLabel.setAttribute("font-size",size*unit);
      oceanLabel.style.letterSpacing=size*unit*.12+"px";
    }
    localOverlay?.scale(unit);
    compactTags.forEach(({ name, group }) => {
      pin(group, anchors.get(name));
      // Hiding the entire group also removes its larger transparent touch target.
      group.style.display = selected ? "none" : "";
    });
    if (selected)
      pin(
        marker,
        mapCities.find((city) => city.name === selectedCity) ||
          anchors.get(selected),
      );
    if (sample) pin(sampleMark, sample);
    map.style.setProperty("--atlas-pixel", unit + "px");
    if (keyboardRegion) focusTip(keyboardRegion);
  }
  const camera = createCamera(map, paintMarks);
  localOverlay=localMap({world:$("mapWorld"),fit:box=>camera.fit(box,true),fitRegion:name=>{if(regions.has(name))camera.fit(regions.get(name).getBBox());},onArea,onGroup});
  localOverlay.scale(unit);
  frame.classList.add("atlas-map-ready");

  function status(name) {
    if (layer === "mar" && !coast.has(name))
      return "Territorio del interior del Perú";
    const theme =
      { todo: "Mar, lluvias y ríos", mar: "Mar", rios: "Ríos", lluvias: "Lluvias" }[layer] ?? layer;
    if (!loaded) return theme + " · Consultando publicaciones…";
    const number = counts.get(name) || 0;
    if (!number) return theme + " · Sin publicaciones regionales en esta capa";
    const breakdown = states?.get(name);
    const upcomingCount = breakdown?.upcoming ?? upcoming?.get(name) ?? 0;
    const parts = [];
    if (breakdown?.active)
      parts.push(
        breakdown.active + (breakdown.active === 1 ? " vigente" : " vigentes"),
      );
    if (upcomingCount)
      parts.push(
        upcomingCount + (upcomingCount === 1 ? " próximo" : " próximos"),
      );
    if (breakdown?.recent)
      parts.push(
        breakdown.recent +
          (breakdown.recent === 1 ? " reciente" : " recientes"),
      );
    const total = number + (number === 1 ? " reporte" : " reportes");
    if (layer==="todo" && regionMarks?.has(name))
      return combinedLabels[regionMarks.get(name)] + " · " + total;
    return (
      theme +
      " · " +
      total +
      (parts.length ? " (" + parts.join(", ") + ")" : "")
    );
  }
  function paintTip(title, detail, x, y) {
    if (tipTitle.textContent !== title) tipTitle.textContent = title;
    if (tipInfo.textContent !== detail) tipInfo.textContent = detail;
    tip.hidden = false;
    const bounds = map.getBoundingClientRect(),
      frameBox = frame.getBoundingClientRect();
    const w = tip.offsetWidth,
      h = tip.offsetHeight;
    const anchorX = x - bounds.left,
      anchorY = y - bounds.top;
    const left = nearest(
      anchorX + 15 + w < bounds.width ? anchorX + 15 : anchorX - w - 15,
      6,
      Math.max(6, bounds.width - w - 6),
    );
    const top = nearest(
      anchorY >= h + 15 ? anchorY - h - 12 : anchorY + 18,
      6,
      Math.max(6, bounds.height - h - 6),
    );
    tip.style.transform =
      "translate(" +
      Math.round(left + bounds.left - frameBox.left) +
      "px," +
      Math.round(top + bounds.top - frameBox.top) +
      "px)";
  }
  function hideTip() {
    if (hover) {
      regions.get(hover)?.classList.remove("atlas-hover");
      hover = "";
    }
    tip.hidden = true;
    activeTip = "";
    sample = null;
    sampleMark.setAttribute("visibility", "hidden");
  }
  function hoverRegion(name, x, y) {
    if (hover !== name) {
      hideTip();
      hover = name;
      regions.get(name).classList.add("atlas-hover");
    }
    activeTip = "region";
    paintTip(regionLabel(name), status(name), x, y);
  }
  function inspect(event, touch = false) {
    const name = event.target.closest("[data-region]")?.dataset.region;
    if (name) return hoverRegion(name, event.clientX, event.clientY);
    if (!grid || layer !== "mar" || !map.getScreenCTM()) return hideTip();
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      map.getScreenCTM().inverse(),
    );
    const cell = oceanCell(grid, p);
    if (
      !cell ||
      [...$("landMask").children].some((path) => path.isPointInFill(p))
    )
      return hideTip();
    if (activeTip !== "ocean") hideTip();
    activeTip = "ocean";
    sample = cell;
    pin(sampleMark, cell);
    sampleMark.setAttribute("visibility", "visible");
    const title = temperature.format(cell.value) + " °C de anomalía";
    const detail = "NOAA OISST · " + dateOfGrid.format(new Date(grid.time));
    paintTip(title, detail, event.clientX, event.clientY);
    if (touch) announce.textContent = title + ". " + detail;
  }
  function setTab(name) {
    regions.get(tabRegion).setAttribute("tabindex", "-1");
    tabRegion = name;
    regions.get(tabRegion).setAttribute("tabindex", "0");
  }
  function select(name, city = "") {
    if (name && !regions.has(name)) return;
    if (name === selected && city === selectedCity) return;
    previewRegion(null);
    hideTip();
    if (selected) {
      const previous = regions.get(selected);
      previous.classList.remove("focused");
      previous.setAttribute("aria-pressed", "false");
    }
    selected = name;
    selectedCity = city;
    keyboardRegion = "";
    frame.classList.toggle("atlas-region-open", Boolean(name));
    updatePicker?.(name, city);
    outline.setAttribute("visibility", name ? "visible" : "hidden");
    marker.setAttribute("visibility", name ? "visible" : "hidden");
    if (name) {
      const path = regions.get(name);
      setTab(name);
      path.classList.add("focused");
      path.setAttribute("aria-pressed", "true");
      outline.setAttribute("d", path.getAttribute("d"));
      markerText.textContent = city || regionLabel(name);
      paintMarks(unit);
      camera.fit(path.getBBox());
      announce.textContent =
        regionLabel(name) + ". " + status(name) + ". Ficha regional abierta.";
    } else {
      camera.home();
      announce.textContent = "Vista nacional del Perú.";
    }
  }
  function focusTip(name) {
    const pt = anchors.get(name).matrixTransform(map.getScreenCTM());
    const b = map.getBoundingClientRect();
    hoverRegion(
      name,
      nearest(pt.x, b.left + 12, b.right - 12),
      nearest(pt.y, b.top + 12, b.bottom - 12),
    );
  }
  map.addEventListener("focusin", (e) => {
    const name = e.target.closest(".region-path")?.dataset.region;
    if (name && e.target.matches(":focus-visible")) {
      keyboardRegion = name;
      camera.reveal(anchors.get(name));
      focusTip(name);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      !tip.hidden &&
      !map.contains(document.activeElement)
    )
      hideTip();
  });
  map.addEventListener("focusout", () => {
    keyboardRegion = "";
    hideTip();
  });
  map.addEventListener("keydown", (e) => {
    const city = e.target.closest("[data-city]")?.dataset;
    if (city && ["Enter", " "].includes(e.key)) {
      e.preventDefault();
      onRegion(city.region, city.city);
      return;
    }
    const name = e.target.closest(".region-path")?.dataset.region;
    if (!name || e.metaKey || e.ctrlKey || e.altKey) return;
    if (
      [
        "ArrowRight",
        "ArrowDown",
        "ArrowLeft",
        "ArrowUp",
        "Home",
        "End",
      ].includes(e.key)
    ) {
      e.preventDefault();
      const next =
        e.key === "Home"
          ? names[0]
          : e.key === "End"
            ? names.at(-1)
            : names[
                (names.indexOf(name) +
                  (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1) +
                  names.length) %
                  names.length
              ];
      setTab(next);
      regions.get(next).focus({ preventScroll: true });
      return;
    }
    if (["Enter", " "].includes(e.key)) {
      e.preventDefault();
      onRegion(name);
    } else if (e.key === "Escape") {
      e.preventDefault();
      keyboardRegion = "";
      hideTip();
      if (selected) onRegion("");
      else camera.home();
    }
  });
  map.addEventListener("pointerdown", e => {
    if (!e.isPrimary || e.button!==0) return;
    keyboardRegion="";
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
    skipClick=false;
  });
  map.addEventListener("pointermove", e => {
    if(drag?.id===e.pointerId && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>7) {
      drag.moved=true;
      hideTip();
    } else if(!drag && e.pointerType!=="touch") inspect(e);
  });
  function endGesture(e) {
    if(drag?.id!==e.pointerId)return;
    skipClick=drag.moved || e.type==="pointercancel";
    drag=null;
  }
  map.addEventListener("pointerup",endGesture);
  map.addEventListener("pointercancel",endGesture);
  map.addEventListener("pointerleave",e=>{
    if(e.pointerType!=="touch")hideTip();
    if(drag?.id===e.pointerId && e.pointerType!=="touch"){drag=null;skipClick=true;}
  });
  // Suppress the synthetic click before it reaches a marker as well as a boundary.
  map.addEventListener("click",e=>{
    if(skipClick && e.detail!==0){e.preventDefault();e.stopPropagation();skipClick=false;}
  },true);
  map.addEventListener("click", (e) => {
    if (e.target.closest(".signal-pin")) return;
    const area = e.target.closest("[data-area]")?.dataset.area;
    if (area) {hideTip();onArea(area);return;}
    const target = e.target.closest("[data-region]")?.dataset;
    const name = target?.region;
    if (name) {
      hideTip();
      onRegion(name, target.city);
    } else inspect(e, true);
  });
  let oceanRequest = null;
  let oceanValidator = {};
  let reportedEmptyGrid = false;
  const sameAxisOrValues = (a, b) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  async function updateOcean() {
    try {
      const response = await fetch(editionAsset("./atlas/oceano.json"), {
        ...opt,
        cache: "no-cache",
        headers: oceanValidator,
        signal: globalThis.AbortSignal?.timeout?.(15000),
      });
      if (response.status === 304 && grid) return false;
      if (!response.ok) throw Error("Cuadrícula NOAA no disponible");
      const next = await response.json();
      if (!validOceanGrid(next)) throw Error("Cuadrícula NOAA incompleta");
      const date = Date.parse(next.time);
      const previousDate = grid ? Date.parse(grid.time) : null;
      if (
        grid &&
        (date < previousDate ||
          (date === previousDate &&
            grid.product === "final" &&
            next.product === "preliminary"))
      )
        return false;

      const etag = response.headers.get("ETag");
      const modified = response.headers.get("Last-Modified");
      const validator = etag
        ? { "If-None-Match": etag }
        : modified
          ? { "If-Modified-Since": modified }
          : {};
      const legendChanged =
        !grid || date !== previousDate || next.product !== grid.product;
      if (
        !legendChanged &&
        sameAxisOrValues(grid.lons, next.lons) &&
        sameAxisOrValues(grid.lats, next.lats) &&
        sameAxisOrValues(grid.values, next.values)
      ) {
        oceanValidator = validator;
        return false;
      }

      // Prepare the whole replacement before touching the display so a bad
      // response or rendering failure leaves the latest verified map intact.
      const dx = next.lons[1] - next.lons[0],
        dy = next.lats[0] - next.lats[1];
      const replacement = {
        x: next.lons[0] + 105 - dx / 2,
        y: 6 - next.lats[0] - dy / 2,
        width: next.lons.length * dx,
        height: next.lats.length * dy,
        href: thermalTexture(next),
      };
      for (const [key, value] of Object.entries(replacement))
        $("thermal").setAttribute(key, value);
      grid = next;
      oceanValidator = validator;
      if (activeTip === "ocean") hideTip();
      if (legendChanged) onOceanReady(grid.time, OCEAN_SOURCE, grid.product);
      return true;
    } catch {
      if (!grid && !reportedEmptyGrid) {
        reportedEmptyGrid = true;
        onOceanReady(null, OCEAN_SOURCE);
      }
      return false;
    }
  }
  function refreshOcean() {
    if (!oceanRequest)
      oceanRequest = updateOcean().finally(() => {
        oceanRequest = null;
      });
    return oceanRequest;
  }
  refreshOcean();
  return {
    refreshOcean,
    local(scope, signals, notices, index) {
      const provincial=Boolean(scope.area);
      map.classList.toggle("atlas-province-view",provincial);
      map.classList.toggle("atlas-region-view",Boolean(scope.region && !provincial));
      regionGroup.setAttribute("aria-hidden",String(provincial));
      regions.get(tabRegion)?.setAttribute("tabindex",provincial?"-1":"0");
      void localOverlay.scope(scope.region,scope.area,index);
      localOverlay.markers(signals,index,name=>anchors.get(name),scope,clearance);
      void localOverlay.sectors(notices,Date.now(),scope.area && index?.byId.get(scope.area.slice(0,4)));
      frame.classList.toggle("has-local-area",Boolean(scope.area));
    },
    regionNames: names,
    select,
    showLayer(nextLayer, nextCounts, options = {}) {
      if (nextLayer !== layer) hideTip();
      layer = nextLayer;
      counts = nextCounts;
      states = options.regionStatus ?? null;
      regionMarks = options.regionMarks ?? null;
      upcoming = options.upcomingCounts ?? null;
      loaded = options.loaded ?? true;
      frame.dataset.mapLayer = layer;
      $("thermal").style.display = layer === "mar" ? "" : "none";
      const combined={grave:"#ee7775b8",impacto:"#e8a052a3",reportado:"#afac8694",
        restablecido:"#79bc9896",observacion:"#83bdd396",pronostico:"#a3a3d588"};
      regions.forEach((path, name) => {
        const tinted =
          (layer !== "mar" || coast.has(name)) && (counts.get(name) || 0) > 0;
        const fills = {
          mar: "#7ee6c844",
          rios: "#50d9c6a6",
          lluvias: "#91b9f3ab",
        };
        const fill=layer==="todo" ? combined[options.regionMarks?.get(name)] || "transparent" :
          tinted ? fills[layer] : "transparent";
        path.style.fill=fill;
        path.style.setProperty("--region-fill",fill);
        path.setAttribute(
          "aria-label",
          regionLabel(name) + ". " + status(name),
        );
      });
      if (hover) tipInfo.textContent = status(hover);
    },
  };
}
