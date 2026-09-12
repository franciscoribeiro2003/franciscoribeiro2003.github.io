import { initSite, el, $, $$, t, state, translateDom } from "../core/site.js";
import { loadContent, mediaUrl } from "../core/data.js";

initSite();

const CONFIG = window.APP_CONFIG || {};
const SATELLITE_TILES = CONFIG.satelliteTiles || [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];

let places = [];
let mode = "places";
let map;

/* --- view modes ----------------------------------------------------------- */

function renderModes() {
  $("#view-modes").replaceChildren(
    ...["places", "albums", "timeline"].map((m) =>
      el("button", {
        type: "button",
        "aria-pressed": String(mode === m),
        text: t(`photography.${m}`),
        onclick: () => {
          mode = m;
          renderModes();
          renderGroups();
        },
      })
    )
  );
}

/* --- cluster map ---------------------------------------------------------- */

function initMap() {
  if (!window.maplibregl || map) return;

  map = new maplibregl.Map({
    container: "photo-map",
    style: {
      version: 8,
      sources: {
        satellite: {
          type: "raster",
          tiles: SATELLITE_TILES,
          tileSize: 256,
          maxzoom: 18,
          attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#0b1220" } },
        { id: "satellite", type: "raster", source: "satellite" },
      ],
    },
    center: [4, 47],
    zoom: 3,
    attributionControl: { compact: true },
  });

  map.on("load", () => {
    map.addSource("photos", {
      type: "geojson",
      cluster: true,
      clusterRadius: 44,
      clusterProperties: { total: ["+", ["get", "count"]] },
      data: {
        type: "FeatureCollection",
        features: places.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lon, p.lat] },
          properties: { name: p.name, count: p.photos?.length || 0 },
        })),
      },
    });

    map.addLayer({
      id: "clusters",
      type: "circle",
      source: "photos",
      paint: {
        "circle-color": "#ffffff",
        "circle-opacity": 0.92,
        "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 1, 15, 8, 24],
        "circle-stroke-color": "#31a0a9",
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "photos",
      layout: {
        "text-field": ["to-string", ["coalesce", ["get", "total"], ["get", "count"]]],
        "text-size": 11,
      },
      paint: { "text-color": "#14343a" },
    });

    map.on("click", "clusters", (e) => {
      const name = e.features?.[0]?.properties?.name;
      const target = name && document.getElementById(`place-${slugify(name)}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    map.on("mouseenter", "clusters", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "clusters", () => (map.getCanvas().style.cursor = ""));

    fitToPlaces();
  });
}

function fitToPlaces() {
  if (!places.length) return;
  const lons = places.map((p) => p.lon);
  const lats = places.map((p) => p.lat);
  map.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: 60, duration: 0 }
  );
}

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-");

/* --- groups --------------------------------------------------------------- */

function photoNode(photo, place) {
  const figure = el("figure", { class: "photo", tabindex: "0", role: "button" }, [
    el("img", {
      src: mediaUrl(photo.thumb || photo.src),
      alt: photo.alt || place.name,
      loading: "lazy",
      decoding: "async",
    }),
  ]);
  const open = () => openLightbox(photo, place);
  figure.addEventListener("click", open);
  figure.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
  return figure;
}

/** Group photos according to the active browsing mode. */
function grouped() {
  if (mode === "places") {
    return places.map((p) => ({
      key: p.name,
      title: p.name,
      sub: formatCoords(p.lat, p.lon),
      photos: p.photos || [],
      place: p,
    }));
  }

  const all = places.flatMap((p) => (p.photos || []).map((ph) => ({ ...ph, place: p })));

  if (mode === "albums") {
    const byAlbum = new Map();
    all.forEach((ph) => {
      const key = ph.album || "Unfiled";
      if (!byAlbum.has(key)) byAlbum.set(key, []);
      byAlbum.get(key).push(ph);
    });
    return [...byAlbum].map(([key, photos]) => ({
      key, title: key, sub: `${photos.length}`, photos, place: photos[0].place,
    }));
  }

  const byYear = new Map();
  all.forEach((ph) => {
    const key = (ph.date || "").slice(0, 4) || "—";
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(ph);
  });
  return [...byYear]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, photos]) => ({
      key, title: key, sub: `${photos.length}`, photos, place: photos[0].place,
    }));
}

function formatCoords(lat, lon) {
  const fmt = (v, pos, neg) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
  return `${fmt(lat, "N", "S")}, ${fmt(lon, "E", "W")}`;
}

function renderGroups() {
  const host = $("#photo-groups");
  const groups = grouped();

  host.replaceChildren(
    ...groups.map((group) =>
      el(
        "section",
        { class: "photo-group", id: `place-${slugify(group.key)}` },
        [
          el("div", { class: "photo-group__head" }, [
            el("div", { class: "photo-group__title" }, [
              el("h2", { class: "t-h2", text: group.title }),
              el("span", { class: "photo-group__coords", text: group.sub }),
            ]),
            el("span", {
              class: "photo-group__coords",
              text: `${group.photos.length} ${t("photography.photographs")}`,
            }),
          ]),
          el(
            "div",
            { class: "photo-row", dataset: { emphasis: group.photos.length >= 3 ? "first" : "" } },
            group.photos.slice(0, 6).map((ph) => photoNode(ph, ph.place || group.place))
          ),
        ]
      )
    )
  );

  if (!groups.length) {
    host.replaceChildren(el("p", { class: "notice", text: t("blog.empty") }));
  }
}

/* --- lightbox ------------------------------------------------------------- */

const lightbox = $("#lightbox");

function openLightbox(photo, place) {
  $("#lightbox-img").src = mediaUrl(photo.src);
  $("#lightbox-img").alt = photo.alt || place?.name || "";
  $("#lightbox-meta").textContent = [
    place?.name,
    place && formatCoords(place.lat, place.lon),
    photo.date,
  ]
    .filter(Boolean)
    .join(" · ");
  lightbox.hidden = false;
  void lightbox.offsetHeight; // flush layout; rAF never fires in a hidden tab
  lightbox.setAttribute("data-open", "");
  document.addEventListener("keydown", onKey);
}

function closeLightbox() {
  lightbox.removeAttribute("data-open");
  document.removeEventListener("keydown", onKey);
  setTimeout(() => (lightbox.hidden = true), 220);
}

function onKey(e) {
  if (e.key === "Escape") closeLightbox();
}
lightbox.addEventListener("click", closeLightbox);

/* --- boot ----------------------------------------------------------------- */

async function boot() {
  const content = await loadContent();
  places = content.photos?.places || [];

  const total = places.reduce((n, p) => n + (p.photos?.length || 0), 0);
  $("#photo-count").textContent = t("photography.counted", {
    n: total,
    p: places.length,
  });

  renderModes();
  renderGroups();
  initMap();
  translateDom();
}

boot();
document.addEventListener("langchange", () => {
  renderModes();
  renderGroups();
  translateDom();
});
