/**
 * Data access. PocketBase is the source of truth and it is read at runtime.
 *
 * The frontend repo ships no content: no JSON, no geometry, nothing about the
 * rides. Everything comes from the backend over its REST API, so editing a
 * stage description in the admin UI shows up on the next page load with no
 * deploy. The only thing baked into the HTML is the <head> SEO block, which a
 * crawler needs before any JavaScript runs.
 *
 * Cold starts are the cost of that. Cloud Run scales to zero, so the first
 * request after an idle period takes a second or two. Two mitigations here:
 *
 *   1. Stale-while-revalidate. A cached copy paints immediately and the
 *      network response replaces it when it lands, so a returning visitor
 *      never waits on the backend.
 *   2. One request per view, not per item. The globe's landing state is a
 *      single overview file covering all 57 routes rather than 57 fetches.
 */

import {
  shapeProfile, shapeExperience, shapeEducation,
  shapeVolunteering, shapePosts, postsOfType, shapePhotos, shapeTrips, shapeSeo,
  groupPhotosByPlace, fileRef,
} from "./normalize.js";

const CONFIG = window.APP_CONFIG || {};
export const PB_URL = (CONFIG.pocketbaseUrl || "").replace(/\/$/, "");

/**
 * Cache key prefix, carrying the shape version.
 *
 * **Bump `v2` whenever the view-model in `normalize.js` changes shape.**
 *
 * A cached copy is rendered immediately, before any network request — that is
 * the whole point of it. So a visitor returning after a shape change would
 * have last week's payload painted through this week's code. When `projects`
 * and `posts` merged, the old payload's projects had `name_en` and no `href`,
 * which renders a sidebar of `undefined/` and links to `/projects/undefined/`
 * until the refresh lands — or for up to `STALE_MS` if the backend is down.
 *
 * Changing the prefix makes every old entry unreadable instead, so a stale
 * visitor gets the loading state and correct content rather than a broken
 * page. `purgeOldCaches()` then reclaims the space.
 */
const CACHE_VERSION = "v4";
const CACHE_PREFIX = `fr:pb:${CACHE_VERSION}:`;
/** How long a cached copy is served without any network wait. */
const FRESH_MS = 1000 * 60 * 5;
/** How long it may still be shown while a refresh is in flight. */
const STALE_MS = 1000 * 60 * 60 * 24 * 7;

/* --- cache ---------------------------------------------------------------- */

/** Drop entries written by an earlier shape version; they can never be read. */
function purgeOldCaches() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("fr:pb:") && !key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* private mode, or storage disabled — nothing to reclaim */
  }
}
purgeOldCaches();

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw);
    const age = Date.now() - at;
    if (age > STALE_MS) return null;
    return { value, fresh: age < FRESH_MS };
  } catch {
    return null;
  }
}

function cacheSet(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* quota or private mode — caching is an optimisation, not a requirement */
  }
}

/* --- fetch ---------------------------------------------------------------- */

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

/** One PocketBase collection, fully paged out. */
async function records(collection, query = "") {
  const res = await getJSON(
    `${PB_URL}/api/collections/${collection}/records?perPage=500${query}`
  );
  return res.items || [];
}

/** Collections that may not exist yet return empty rather than failing. */
const optional = (collection, query) =>
  records(collection, query).catch(() => []);

/**
 * Read-through cache with stale-while-revalidate.
 *
 * `onUpdate` fires only when the network result differs from what was already
 * painted, so a page can render instantly from cache and quietly correct
 * itself if the backend has changed.
 */
/**
 * Requests in flight, keyed the same as the cache.
 *
 * Without this, two callers on one page each fire the loader: the site chrome
 * wants the profile for the footer while the page module wants the same
 * `content` payload, and that is seven collections fetched twice against a
 * backend that scales to zero. They share one request instead.
 */
const inFlight = new Map();

async function cached(key, loader, onUpdate) {
  const hit = cacheGet(key);

  if (hit?.fresh) return hit.value;

  const pending = inFlight.get(key);
  if (pending) return hit ? hit.value : pending;

  const network = loader()
    .then((value) => {
      cacheSet(key, value);
      if (hit && onUpdate && JSON.stringify(value) !== JSON.stringify(hit.value)) {
        onUpdate(value);
      }
      return value;
    })
    .catch((err) => {
      console.warn(`[data] ${key} unavailable:`, err.message);
      if (hit) return hit.value;
      throw err;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, network);

  // A stale copy paints now; the refresh lands on its own.
  return hit ? hit.value : network;
}

/* --- content -------------------------------------------------------------- */

const EMPTY_CONTENT = {
  profile: null, contact: [], experience: [], education: [],
  volunteering: [], posts: [], projects: [], blog: [],
  photos: { places: [] }, seo: {},
};

/**
 * Everything the non-map pages render, in one round of parallel requests.
 * `onUpdate` receives a fresher copy if the cached one was out of date.
 */
export async function loadContent(onUpdate) {
  if (!PB_URL) {
    console.warn("[data] APP_CONFIG.pocketbaseUrl is not set — no content to load.");
    return EMPTY_CONTENT;
  }

  return cached(
    "content",
    async () => {
      const [
        webpage, experience, education,
        volunteering, posts, photos, seo,
      ] = await Promise.all([
        optional("webpage"),
        optional("experience", "&expand=positions"),
        optional("education", "&sort=-start"),
        optional("volunteering", "&expand=positions"),
        // One collection for the blog and the projects, so one request.
        // Sorting and splitting happen in shapePosts.
        optional("posts", "&sort=order,-date&filter=(published=true)"),
        optional("photos", "&sort=-taken_at&filter=(published=true)"),
        optional("page_seo"),
      ]);

      const photoList = shapePhotos(photos);
      const profile = shapeProfile(webpage[0]);
      const allPosts = shapePosts(posts);
      return {
        profile,
        // The pages read contacts at the top level; they live on the webpage
        // record because there is only ever one set of them.
        contact: profile?.contacts || [],
        experience: shapeExperience(experience),
        education: shapeEducation(education),
        volunteering: shapeVolunteering(volunteering),
        // `posts` is everything; `projects` and `blog` are views over it by
        // type. The pages take the view they need, so none of them has to know
        // that the two used to be separate collections.
        posts: allPosts,
        projects: postsOfType(allPosts, "project"),
        blog: postsOfType(allPosts, "blog"),
        photos: { places: groupPhotosByPlace(photoList), all: photoList },
        seo: shapeSeo(seo),
      };
    },
    onUpdate
  );
}

/* --- trips ---------------------------------------------------------------- */

/** Trips with their stages nested, and any stage photos attached. */
export async function loadTrips(onUpdate) {
  if (!PB_URL) return [];
  return cached(
    "trips",
    async () => {
      const [trips, stages, photos] = await Promise.all([
        optional("trips", "&sort=order&filter=(published=true)"),
        optional("stages", "&sort=order"),
        optional("photos", "&filter=(published=true)"),
      ]);
      return shapeTrips(trips, stages, shapePhotos(photos));
    },
    onUpdate
  );
}

/**
 * The map's landing state: every route in one file.
 *
 * `map_assets` holds a single `overview` record whose `routes` file carries all
 * 57 stages at overview fidelity. One request for the whole globe — the reason
 * this is not 57 separate fetches through a scale-to-zero backend.
 */
let overviewPromise = null;

export async function loadMapAssets() {
  if (!PB_URL) return null;
  if (!overviewPromise) {
    overviewPromise = cached("map-assets", async () => {
      const items = await records(
        "map_assets",
        "&perPage=1&filter=" + encodeURIComponent("(key='overview')")
      );
      const record = items[0];
      if (!record) return null;
      return {
        routes: record.routes
          ? `${PB_URL}/api/files/${record.collectionId}/${record.id}/${record.routes}`
          : "",
        clouds: record.clouds
          ? `${PB_URL}/api/files/${record.collectionId}/${record.id}/${record.clouds}`
          : "",
        tripCount: record.trip_count || 0,
        stageCount: record.stage_count || 0,
        distanceKm: record.distance_km || 0,
        climbM: record.climb_m || 0,
      };
    }).catch(() => null);
  }
  return overviewPromise;
}

const EMPTY_FC = { type: "FeatureCollection", features: [] };
let routesPromise = null;

export async function loadRoutes() {
  if (!routesPromise) {
    routesPromise = (async () => {
      const assets = await loadMapAssets();
      if (!assets?.routes) return EMPTY_FC;
      return getJSON(assets.routes);
    })().catch((err) => {
      console.warn("[data] routes unavailable:", err.message);
      routesPromise = null;
      return EMPTY_FC;
    });
  }
  return routesPromise;
}

export async function loadClouds() {
  const assets = await loadMapAssets();
  if (!assets?.clouds) return null;
  return getJSON(assets.clouds).catch(() => null);
}

const trackCache = new Map();

/**
 * One stage at full detail, fetched only when a visitor opens it.
 * `stage.trackFile` is the host-less path stored on the stage record.
 */
export async function loadTrack(stage) {
  const ref = typeof stage === "string" ? stage : stage?.trackFile;
  if (!ref || !PB_URL) return null;
  if (trackCache.has(ref)) return trackCache.get(ref);

  const promise = getJSON(`${PB_URL}/${ref}`).catch((err) => {
    console.warn("[data] track unavailable:", err.message);
    trackCache.delete(ref);
    return null;
  });
  trackCache.set(ref, promise);
  return promise;
}

/* --- media ---------------------------------------------------------------- */

/** Resolve a host-less `api/files/…` path against the backend. */
export function mediaUrl(ref) {
  if (!ref) return "";
  if (/^https?:\/\//.test(ref)) return ref;
  const clean = ref.replace(/^\//, "");
  return PB_URL ? `${PB_URL}/${clean}` : clean;
}

/* --- guestbook ------------------------------------------------------------ */

/**
 * The approved pages, oldest first.
 *
 * Oldest first because the book is read like a book: page one is the first
 * person who signed it. The server also filters to `approved`, so an
 * unmoderated page is invisible here and to everyone else.
 */
export async function listGuestbook({ limit = 200 } = {}) {
  if (!PB_URL) return [];
  const items = await records(
    "guestbook",
    `&perPage=${limit}&sort=created&filter=` + encodeURIComponent("(approved=true)")
  ).catch(() => []);
  return items.map((r) => ({
    id: r.id,
    name: r.name || "",
    alt: r.alt_text || "",
    created: r.created || "",
    image: fileRef(r, "image"),
  }));
}

/**
 * Add a page.
 *
 * Multipart, because the page is a PNG rendered in the browser rather than a
 * row of text. `approved` is sent explicitly as false: the collection's create
 * rule is `approved = false`, so a request that tried to publish itself is
 * rejected by the server rather than trusted.
 */
export async function signGuestbook({ name, altText, blob }) {
  if (!PB_URL) throw new Error("no-backend");
  if (!blob) throw new Error("no-drawing");

  const form = new FormData();
  form.append("image", blob, "page.png");
  form.append("name", String(name || "").slice(0, 60));
  form.append("alt_text", String(altText || "").slice(0, 500));
  form.append("approved", "false");

  const res = await fetch(`${PB_URL}/api/collections/guestbook/records`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json();
}
