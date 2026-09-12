/**
 * The map page: a MapLibre globe carrying every recorded route, paired with a
 * travel journal that drives it.
 *
 * Cost note: routes are static GeoJSON served by GitHub Pages. The only paid
 * dependency is the satellite raster source, which is configurable.
 */

import { initSite, el, $, $$, t, state, num, translateDom } from "../core/site.js";
import { loadTrips, loadTrack, loadRoutes, mediaUrl } from "../core/data.js";
import { generateCloudInstances } from "../core/clouds.js";
import { buildCloudInstances, createCloudLayer } from "../core/clouds3d.js";

initSite({ footer: false });

const CONFIG = window.APP_CONFIG || {};

/* Default imagery: Esri World Imagery. Free to use with attribution for
   non-commercial sites, and needs no API key — which keeps this page at zero
   marginal cost. Override with APP_CONFIG.satelliteTiles to use MapTiler etc. */
const SATELLITE_TILES = CONFIG.satelliteTiles || [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];
const SATELLITE_ATTRIBUTION =
  CONFIG.satelliteAttribution ||
  "Imagery © Esri, Maxar, Earthstar Geographics";

/**
 * Transport modes get their own colour on the globe. Cycling is only the first
 * category — the chips and the colours are both driven by what the data has.
 */
const MODE_COLOURS = {
  cycling: "#ff3b2a",
  hiking: "#ffb020",
  boat: "#3ba9ff",
  train: "#c65cff",
  other: "#9aa0a6",
};
/**
 * A selected route runs white-hot rather than a different hue, so it reads as
 * the same route turned up rather than as a different kind of thing.
 */
const MODE_HIGHLIGHT = "#fff0ec";

/** Fallback frame, only used before the trips have loaded. */
const FALLBACK_VIEW = { center: [4, 48], zoom: 2 };

/** The union of every trip's bounding box — the landing frame. */
function allTripsBbox(list = trips) {
  const boxes = list.map((t) => t.bbox).filter((b) => Array.isArray(b) && b.length === 4);
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

let map;
let trips = [];
let active = null;
let activeStage = null;
let modeFilter = "all";
let idleSpin = true;

/* --- style ---------------------------------------------------------------- */

function baseStyle() {
  return {
    version: 8,
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      satellite: {
        type: "raster",
        tiles: SATELLITE_TILES,
        tileSize: 256,
        maxzoom: 18,
        attribution: SATELLITE_ATTRIBUTION,
      },
    },
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#05070d" } },
      { id: "satellite", type: "raster", source: "satellite" },
    ],
    sky: {
      "sky-color": "#0b1a2e",
      "horizon-color": "#8fb8d8",
      "fog-color": "#0b1220",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.5,
    },
  };
}

/* --- cloud cover over the undiscovered world ------------------------------ */

/**
 * Clouds are 3D geometry in a MapLibre custom layer — see core/clouds3d.js.
 *
 * Placement comes from core/clouds.js: nothing is generated within
 * CLOUD_NEAR_KM of a trip's bounding box, the probability of a cloud existing
 * ramps across to CLOUD_FAR_KM, and beyond that the cover is solid. The radius
 * is a spawn rule, so the boundary is where instances stop rather than where
 * an opacity ramp ends.
 *
 * The count is lower than the sprite version used because each cloud expands
 * into five to nine puffs, and each puff is an instanced 128-triangle mesh.
 */
const CLOUD_NEAR_KM = 200;
const CLOUD_FAR_KM = 1100;
/**
 * The far count is high because coverage, not size, is what makes the unknown
 * world feel unknown. With 900 clouds the whole of North Africa stayed legible
 * despite being 2 000 km from any route: the masses were large but too sparse.
 * Remote clouds carry far fewer detail lobes (see clouds3d.js), so tripling
 * the count costs much less than tripling the puff budget would suggest.
 */
const CLOUD_COUNT = 2900;
// Tuned against measured sky coverage, not guessed. The collar overlaps the
// global tier between farKm and REMOTE_KM, and at 1800 that overlap produced
// nine cloud layers around 2 000 km against four in the deep field — a dense
// ring, and wasted overdraw. 1100 keeps the band opaque without the pile-up.
const CLOUD_NEAR_COUNT = 1100;

let cloudLayer = null;

function cloudInstancesForTrips() {
  const placement = generateCloudInstances({
    tripBboxes: trips.map((t) => t.bbox).filter(Boolean),
    count: CLOUD_COUNT,
    nearCount: CLOUD_NEAR_COUNT,
    nearKm: CLOUD_NEAR_KM,
    farKm: CLOUD_FAR_KM,
  });
  return buildCloudInstances(placement.features);
}

function addClouds() {
  try {
    const instances = cloudInstancesForTrips();
    cloudLayer = createCloudLayer({ id: "clouds-3d", instances });
    map.addLayer(cloudLayer);
  } catch (err) {
    // Without this the map still works and the clouds are simply absent, with
    // nothing in the console to say why.
    console.error("[clouds] failed to add the layer:", err);
    if (typeof window !== "undefined") window.__clouds = { added: false, error: String(err) };
  }
}

/** Re-scatter when the trips change, so the clearing follows the routes. */
function refreshClouds() {
  cloudLayer?.setInstances?.(cloudInstancesForTrips());
}

/* --- routes --------------------------------------------------------------- */

const EMPTY_FC = { type: "FeatureCollection", features: [] };

async function addRoutes() {
  map.addSource("routes", { type: "geojson", data: EMPTY_FC });

  /**
   * A route is three stacked lines from the same geometry: a wide, heavily
   * blurred halo, a tighter brighter one, and a crisp core. `line-blur` is
   * what makes a glow possible without writing a shader.
   *
   * The dark casing that used to sit underneath is gone — a dark outline
   * around a glowing line cancels the glow it is meant to support.
   *
   * The glow strength is a compromise, because how well it reads depends on
   * what is under it. Over dark ocean a red halo adds light and looks like
   * glow; over pale desert or snow it darkens the ground and looks like a
   * smear. Rendering the same route over ocean, desert and forest, a halo
   * strong enough to be striking on water turned the Sahara into a pink wash.
   * These values are the strongest that stay clean on light terrain.
   *
   * To push it further: raise `line-opacity` on routes-halo (0.36) and
   * routes-glow (0.72), or widen their `line-width`. To calm it down, lower
   * the halo opacity first — it is the layer that muddies pale ground.
   */
  const modeColour = [
    "match",
    ["get", "mode"],
    ...Object.entries(MODE_COLOURS).flat(),
    MODE_COLOURS.other,
  ];
  const dimmable = (lit, dim) => [
    "case",
    ["boolean", ["feature-state", "dimmed"], false], dim,
    lit,
  ];

  map.addLayer({
    id: "routes-halo",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": modeColour,
      "line-opacity": dimmable(0.36, 0.09),
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 12, 10, 30],
      "line-blur": ["interpolate", ["linear"], ["zoom"], 2, 10, 10, 24],
    },
  });

  map.addLayer({
    id: "routes-glow",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": modeColour,
      "line-opacity": dimmable(0.72, 0.2),
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 6, 10, 14],
      "line-blur": ["interpolate", ["linear"], ["zoom"], 2, 4, 10, 9],
    },
  });

  map.addLayer({
    id: "routes-line",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false], MODE_HIGHLIGHT,
        ["boolean", ["feature-state", "hover"], false], MODE_HIGHLIGHT,
        modeColour,
      ],
      "line-opacity": dimmable(1, 0.4),
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        2, ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.8],
        10, ["case", ["boolean", ["feature-state", "selected"], false], 6, 4],
      ],
    },
  });

  // Full-detail geometry for the one stage a visitor has opened.
  map.addSource("stage-detail", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "stage-detail-glow",
    type: "line",
    source: "stage-detail",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": MODE_COLOURS.cycling,
      "line-opacity": 0.7,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 12, 14, 26],
      "line-blur": ["interpolate", ["linear"], ["zoom"], 6, 8, 14, 18],
    },
  });
  map.addLayer({
    id: "stage-detail-line",
    type: "line",
    source: "stage-detail",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": MODE_HIGHLIGHT,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 3, 14, 7],
    },
  });

  map.addLayer({
    id: "trip-pins",
    type: "circle",
    source: "routes",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-color": modeColour,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
      "circle-blur": 0.15,
    },
  });

  await refreshRoutes();
}

/**
 * Push the visible routes to the map.
 *
 * routes.geojson holds all 57 stages, so mode filtering is a client-side
 * filter over data already in memory rather than 57 more requests.
 */
async function refreshRoutes() {
  const all = await loadRoutes();
  const tripById = new Map(trips.map((t) => [t.id, t]));

  const features = all.features
    .filter((f) => {
      const trip = tripById.get(f.properties.trip);
      return modeFilter === "all" || (trip?.mode ?? f.properties.mode) === modeFilter;
    })
    .map((f) => ({
      ...f,
      id: hashId(f.properties.track),
      properties: {
        ...f.properties,
        tripId: f.properties.trip,
        stageId: f.properties.stage,
      },
    }));

  map.getSource("routes")?.setData({ type: "FeatureCollection", features });

  featureIndex.clear();
  for (const f of features) {
    if (!featureIndex.has(f.properties.tripId)) {
      featureIndex.set(f.properties.tripId, []);
    }
    featureIndex.get(f.properties.tripId).push({
      id: f.id,
      stageId: f.properties.stageId,
      track: f.properties.track,
    });
  }
  applyHighlight();
}

/**
 * Swap a single stage up to full detail. The overview geometry is simplified
 * for globe zoom; once a visitor is looking at one stage, fetch the ~20 m
 * version so the line still reads as a road at street zoom.
 */
async function upgradeStageDetail(stage, mode) {
  const track = await loadTrack(stage);
  if (!track || !map.getSource("stage-detail")) return;
  // The detail source carries geometry only, with no `mode` property to match
  // on, so the glow colour is set here rather than by an expression.
  map.setPaintProperty(
    "stage-detail-glow",
    "line-color",
    MODE_COLOURS[mode] || MODE_COLOURS.other,
  );
  map.getSource("stage-detail").setData(track);
}

function clearStageDetail() {
  map.getSource("stage-detail")?.setData(EMPTY_FC);
}

const featureIndex = new Map();

/** MapLibre feature-state needs numeric ids; hash the stable string key. */
function hashId(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function applyHighlight(stageId = null) {
  // The journal must keep working when the globe does not — WebGL can be
  // unavailable, blocked, or still loading.
  if (!map?.getSource?.("routes")) return;
  for (const [tripId, feats] of featureIndex) {
    const isActive = active && tripId === active.id;
    for (const f of feats) {
      map.setFeatureState(
        { source: "routes", id: f.id },
        {
          selected: Boolean(isActive && (!stageId || f.stageId === stageId)),
          dimmed: Boolean(active && !isActive),
        }
      );
    }
  }
}

/* --- camera --------------------------------------------------------------- */

function flyToBounds(bbox, padding = 90, duration = 1600) {
  // Deliberately no `map.loaded()` guard: the opening frame is set from inside
  // the `load` handler, where loaded() can still be false, and the fit would
  // then be skipped without a word. fitBounds only needs a sized container.
  if (!Array.isArray(bbox) || bbox.length !== 4 || !map) return;
  const [w, s, e, n] = bbox;
  // A stage that barely moves has no extent to fit; pad it so fitBounds does
  // not slam to maximum zoom.
  const padLon = e === w ? 0.05 : 0;
  const padLat = n === s ? 0.05 : 0;
  idleSpin = false;
  map.fitBounds(
    [
      [Math.min(w, e) - padLon, Math.min(s, n) - padLat],
      [Math.max(w, e) + padLon, Math.max(s, n) + padLat],
    ],
    { padding, duration, essential: true, maxZoom: 11 }
  );
}

function resetView() {
  active = null;
  activeStage = null;
  clearStageDetail();
  applyHighlight();
  renderTripList();
  renderStory(null);
  idleSpin = true;
  const bbox = allTripsBbox();
  if (bbox) flyToBounds(bbox, 120, 1400);
  else if (map) map.easeTo({ ...FALLBACK_VIEW, duration: 1400 });
}

/** Slow idle rotation, paused whenever the visitor is doing anything. */
function startIdleSpin() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;
  // The landing frame is a deliberate composition; drifting off it immediately
  // would undo that. Rotation only resumes after the reset button.
  idleSpin = false;
  let last = performance.now();
  const tick = (now) => {
    const dt = now - last;
    last = now;
    if (idleSpin && !document.hidden) {
      map.setCenter([map.getCenter().lng + dt * 0.0018, map.getCenter().lat]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  ["mousedown", "touchstart", "wheel"].forEach((evt) =>
    map.getCanvas().addEventListener(evt, () => (idleSpin = false), { passive: true })
  );
}

/* --- journal panel -------------------------------------------------------- */

/**
 * Mode chips, driven entirely by the data.
 *
 * Only modes that actually have trips get a chip — no greyed-out "Boat" and
 * "Train" advertising categories that are empty. The model still supports
 * them; they appear the day a trip uses one.
 *
 * Each chip carries a swatch in that mode's route colour, so the list doubles
 * as the legend for the globe.
 */
function renderModeFilters() {
  const host = $("#mode-filters");
  const present = [...new Set(trips.map((tr) => tr.mode).filter(Boolean))].sort();

  const modes = present.length ? ["all", ...present] : [];
  host.hidden = !modes.length;
  if (modeFilter !== "all" && !present.includes(modeFilter)) modeFilter = "all";

  host.replaceChildren(
    ...modes.map((mode) =>
      el(
        "button",
        {
          class: "chip",
          type: "button",
          "aria-pressed": String(modeFilter === mode),
          onclick: () => {
            modeFilter = mode;
            active = null;
            renderModeFilters();
            renderTripList();
            renderStory(null);
            refreshRoutes();
            const bbox = allTripsBbox(
              trips.filter((tr) => mode === "all" || tr.mode === mode)
            );
            if (bbox) flyToBounds(bbox, 120);
          },
        },
        [
          mode !== "all" &&
            el("span", {
              class: "chip__swatch",
              "aria-hidden": "true",
              style: `background:${MODE_COLOURS[mode] || MODE_COLOURS.other}`,
            }),
          el("span", { text: t(`map.modes.${mode}`) || mode }),
        ].filter(Boolean)
      )
    )
  );
}

function renderTripList() {
  const host = $("#trip-list");
  const visible = trips.filter((tr) => modeFilter === "all" || tr.mode === modeFilter);
  $("#trip-count").textContent = visible.length;

  host.replaceChildren(
    ...visible.map((trip) =>
      el(
        "button",
        {
          class: "trip",
          type: "button",
          "aria-current": String(active?.id === trip.id),
          onclick: () => selectTrip(trip),
          onmouseenter: () => applyHighlight(),
        },
        [
          el("span", {
            class: "trip__marker",
            "aria-hidden": "true",
            style: `background:${MODE_COLOURS[trip.mode] || MODE_COLOURS.other}`,
          }),
          el("span", { class: "trip__body" }, [
            el("span", { class: "trip__name", text: trip.title }),
            el("span", {
              class: "trip__meta",
              text: `${trip.year} · ${(trip.stages || []).length} ${t("map.stages").toLowerCase()} · ${num(trip.distanceKm)} km`,
            }),
          ]),
        ]
      )
    )
  );
}

function renderStory(trip) {
  const host = $("#story");
  if (!trip) {
    host.replaceChildren(
      el("p", { class: "t-caps muted", text: t("map.allRoutes") }),
      el("p", { class: "t-body secondary", text: t("map.intro") }),
      el("p", { class: "t-mono-xs muted", text: t("map.clouds") })
    );
    updateGlobeCaption();
    return;
  }

  host.replaceChildren(
    el("p", { class: "t-caps muted", text: t("map.selected") }),
    el("h2", { class: "t-h1", text: trip.title }),
    el("p", { class: "detail__meta" }, [
      el("span", { text: trip.dates || String(trip.year) }),
      el("span", { class: "sep", text: "·" }),
      el("span", { text: trip.region || "" }),
      el("span", { class: "sep", text: "·" }),
      el("span", { class: "accent", text: t(`map.modes.${trip.mode}`) || trip.mode }),
    ]),
    el("p", { class: "t-body secondary", text: localized(trip, "story") }),
    el("div", { class: "stats" }, [
      stat(num(trip.distanceKm), t("map.stats.km")),
      stat(num(trip.climbM), t("map.stats.climb")),
      stat(String(trip.days ?? (trip.stages || []).length), t("map.stats.days")),
    ]),
    el("p", { class: "t-caps muted", text: t("map.stages") }),
    el(
      "div",
      { class: "stages" },
      (trip.stages || []).flatMap((stage, i) => stageNodes(trip, stage, i))
    )
  );
  updateGlobeCaption(trip);
}

const stat = (value, label) =>
  el("div", {}, [
    el("p", { class: "stat__value", text: value }),
    el("p", { class: "stat__label", text: label }),
  ]);

/**
 * One stage row, plus — when it is the open stage — its written description
 * and any photographs attached to it in PocketBase.
 */
function stageNodes(trip, stage, i) {
  const isOpen = activeStage?.track === stage.track;
  const description = localized(stage, "description");
  const photos = stage.photos || [];

  const row = el(
    "button",
    {
      class: "stage",
      type: "button",
      "aria-current": String(isOpen),
      "aria-expanded": String(isOpen),
      onclick: () => (isOpen ? collapseStage(trip) : selectStage(trip, stage)),
    },
    [
      el("span", { class: "stage__num", text: String(i + 1).padStart(2, "0") }),
      el("span", { class: "stage__name", text: stage.name }),
      el("span", {
        class: "stage__meta",
        text: `${num(stage.distanceKm)} km · ${num(stage.climbM)} m`,
      }),
    ]
  );

  if (!isOpen) return [row];

  const detail = el("div", { class: "stage__detail" }, [
    description
      ? el("p", { class: "t-body-s secondary", text: description })
      : el("p", { class: "t-mono-xs muted", text: t("map.noDescription") }),
    photos.length
      ? el(
          "div",
          { class: "stage__photos" },
          photos.map((photo) =>
            el("img", {
              src: mediaUrl(photo.thumb || photo.src),
              alt: localized(photo, "alt") || stage.name,
              loading: "lazy",
              decoding: "async",
            })
          )
        )
      : null,
    stage.profile?.length ? elevationSparkline(stage) : null,
  ]);

  return [row, detail];
}

function collapseStage(trip) {
  activeStage = null;
  clearStageDetail();
  applyHighlight();
  renderStory(trip);
}

/** A tiny inline elevation profile — 120 samples, drawn as one SVG path. */
function elevationSparkline(stage) {
  const points = stage.profile;
  const W = 300;
  const H = 44;
  const maxKm = points[points.length - 1][0] || 1;
  const elevations = points.map((p) => p[1]);
  const lo = Math.min(...elevations);
  const hi = Math.max(...elevations);
  const span = hi - lo || 1;

  const d = points
    .map(([km, ele], i) => {
      const x = (km / maxKm) * W;
      const y = H - ((ele - lo) / span) * (H - 4) - 2;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Elevation profile: ${stage.minEleM}–${stage.maxEleM} m over ${stage.distanceKm} km`
  );

  const area = document.createElementNS(NS, "path");
  area.setAttribute("d", `${d} L ${W} ${H} L 0 ${H} Z`);
  area.setAttribute("class", "sparkline__area");
  svg.append(area);

  const line = document.createElementNS(NS, "path");
  line.setAttribute("d", d);
  line.setAttribute("class", "sparkline__line");
  svg.append(line);

  return el("div", { class: "stage__profile" }, [
    svg,
    el("p", {
      class: "t-mono-xs muted",
      text: `${num(stage.minEleM)}–${num(stage.maxEleM)} m`,
    }),
  ]);
}

function localized(obj, field) {
  return obj[`${field}_${state.lang}`] ?? obj[`${field}_en`] ?? obj[field] ?? "";
}

function updateGlobeCaption(trip) {
  if (trip) {
    $("#globe-title").textContent = trip.title;
    $("#globe-meta").textContent =
      `${(trip.stages || []).length} ${t("map.stages").toLowerCase()} · ${num(trip.distanceKm)} km`;
    return;
  }
  const stages = trips.reduce((n, tr) => n + (tr.stages || []).length, 0);
  const km = trips.reduce((n, tr) => n + (tr.distanceKm || 0), 0);
  $("#globe-title").textContent = t("map.allRoutes");
  $("#globe-meta").textContent = t("map.summary", {
    trips: trips.length,
    stages,
    km: num(km),
  });
}

function selectTrip(trip) {
  active = trip;
  activeStage = null;
  clearStageDetail();
  renderTripList();
  renderStory(trip);
  applyHighlight();
  flyToBounds(trip.bbox);
}

function selectStage(trip, stage) {
  active = trip;
  activeStage = stage;
  applyHighlight(stage.id);
  renderStory(trip);
  upgradeStageDetail(stage, trip.mode);
  flyToBounds(stage.bbox || trip.bbox, 140);
}

/* --- boot ----------------------------------------------------------------- */

async function boot() {
  trips = await loadTrips();

  try {
    map = new maplibregl.Map({
      container: "globe",
      style: baseStyle(),
      ...FALLBACK_VIEW,
      attributionControl: { compact: true },
      hash: false,
    });
  } catch (err) {
    // No WebGL: the journal below still lists every trip and stage.
    console.warn("[map] globe unavailable:", err.message);
    $("#globe").append(
      el("p", { class: "globe-overlay globe-overlay--hint", text: t("map.intro") })
    );
    renderModeFilters();
    renderTripList();
    renderStory(null);
    translateDom();
    return;
  }

  map.on("load", async () => {
    // Globe projection is MapLibre GL JS v5+; guard so an older CDN pin still
    // renders a flat map rather than throwing.
    if (typeof map.setProjection === "function") {
      map.setProjection({ type: "globe" });
    }
    addClouds();
    await addRoutes();

    // Open on everywhere I have been, rather than a guessed centre.
    const bbox = allTripsBbox();
    if (bbox) flyToBounds(bbox, 120, 0);

    startIdleSpin();

    // Bound to the glow, not the core: the core is under two pixels wide at
    // globe zoom, and the glow layer gives a 5-12 px hit target for the same
    // geometry.
    map.on("click", "routes-glow", (e) => {
      const tripId = e.features?.[0]?.properties?.tripId;
      const trip = trips.find((tr) => tr.id === tripId);
      if (trip) selectTrip(trip);
    });
    map.on("mouseenter", "routes-glow", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "routes-glow", () => (map.getCanvas().style.cursor = ""));
  });

  $("#zoom-in").addEventListener("click", () => { idleSpin = false; map.zoomIn(); });
  $("#zoom-out").addEventListener("click", () => { idleSpin = false; map.zoomOut(); });
  $("#reset-view").addEventListener("click", resetView);

  renderModeFilters();
  renderTripList();
  renderStory(null);
  translateDom();

  document.addEventListener("langchange", () => {
    renderModeFilters();
    renderTripList();
    renderStory(active);
    translateDom();
  });
}

boot();
