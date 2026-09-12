/**
 * Turn raw PocketBase records into the shapes the pages render.
 *
 * Shared by the browser (js/core/data.js) and the build-time prerenderer
 * (tools/prerender.mjs), so a crawler and a reader are looking at the same
 * text derived the same way.
 */

/* --- text ----------------------------------------------------------------- */

/**
 * Named HTML entities the rich-text editor emits for accented characters.
 * PocketBase stores what TinyMCE produced, so Portuguese arrives as
 * "Inform&aacute;tica" rather than "Informática".
 */
const NAMED_ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", auml: "ä", aring: "å",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  oacute: "ó", ograve: "ò", ocirc: "ô", otilde: "õ", ouml: "ö",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  ccedil: "ç", ntilde: "ñ", yacute: "ý",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Auml: "Ä",
  Eacute: "É", Egrave: "È", Ecirc: "Ê", Euml: "Ë",
  Iacute: "Í", Igrave: "Ì", Icirc: "Î", Iuml: "Ï",
  Oacute: "Ó", Ograve: "Ò", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö",
  Uacute: "Ú", Ugrave: "Ù", Ucirc: "Û", Uuml: "Ü",
  Ccedil: "Ç", Ntilde: "Ñ",
  szlig: "ß", deg: "°", middot: "·", bull: "•",
  hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", euro: "€", copy: "©", reg: "®", trade: "™",
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) =>
      NAMED_ENTITIES[name] !== undefined ? NAMED_ENTITIES[name] : whole
    );
}

/** PocketBase `editor` fields hold HTML; the site renders plain text. */
export function stripHtml(value) {
  if (!value) return "";
  const withBreaks = String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])>\s*/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "· ")
    .replace(/<[^>]+>/g, "");
  // Decode after stripping tags, so an encoded "&lt;script&gt;" in the source
  // cannot become a live tag on the way out.
  return decodeEntities(withBreaks)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const asList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through to comma splitting */
    }
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

export const asJson = (value, fallback) => {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const year = (d) => (d ? String(d).slice(0, 4) : "");
const day = (d) => (d ? String(d).slice(0, 10) : "");

/* --- shapes --------------------------------------------------------------- */

/**
 * `published` is set explicitly by the CV migration. Roles dropped from the CV
 * stay in the database but are hidden here — history without clutter.
 */
const shown = (positions) => (positions || []).filter((p) => p.published);

/**
 * The `webpage` singleton, which is the whole identity of the site.
 *
 * Every fact here comes from the record — the name and job title included.
 * They used to be string literals in this file and in the prerenderer, which
 * meant a job title could only change by way of a commit, and put content in a
 * repo that is supposed to hold none.
 *
 * `contacts` is a list of `{ glyph, label, href, external }`. The email and the
 * profile URLs the structured data needs are derived from it rather than
 * stored twice — see `contactHref` and `profileUrls`.
 */
export function shapeProfile(webpage) {
  if (!webpage) return null;
  const contacts = asJson(webpage.contacts, []);
  return {
    name: webpage.name || "",
    jobTitle_pt: webpage.job_title_pt || "",
    jobTitle_en: webpage.job_title_en || "",
    locality: webpage.locality || "",
    country: webpage.country || "",
    portrait: fileRef(webpage, "photo", "480x0"),
    // Unsized, for social cards: a scaler crops to a square thumb, and a
    // cropped face is a poor preview image.
    portraitFull: fileRef(webpage, "photo"),
    cv: fileRef(webpage, "cv"),
    repoUrl: webpage.repo_url || "",
    // meta-name → content, e.g. { "google-site-verification": "…" }. Baked
    // into every page's <head> by the prerenderer: the search engines' own
    // verification fetches do not run JavaScript.
    siteVerification: asJson(webpage.site_verification, {}) || {},
    bio_pt: stripHtml(webpage.about_pt),
    bio_en: stripHtml(webpage.about_en),
    tagline_pt: webpage.tagline_pt || "",
    tagline_en: webpage.tagline_en || "",
    interests_pt: webpage.interests_pt || "",
    interests_en: webpage.interests_en || "",
    skillGroups: asJson(webpage.skill_groups, []),
    contacts,
  };
}

/** The first contact whose href matches, e.g. `mailto:` or `github.com`. */
export const contactHref = (contacts, pattern) =>
  (contacts || []).map((c) => c.href || "").find((h) => pattern.test(h)) || "";

/**
 * Every off-site profile in the contact list, for schema.org `sameAs`.
 *
 * Anything http(s) qualifies: a new profile added in the admin UI reaches the
 * structured data without a code change, which is the point.
 */
export const profileUrls = (contacts) =>
  (contacts || [])
    .map((c) => c.href || "")
    .filter((h) => /^https?:\/\//i.test(h));

/** One card per position, not per company: two roles at one employer are two. */
export function shapeExperience(companies) {
  const roles = (companies || []).flatMap((company) =>
    shown(company.expand?.positions).map((p) => ({
      company: company.name_en || company.company_name,
      location: company.location,
      role_pt: p.title_pt,
      role_en: p.title_en,
      start: p.start,
      end: p.end || null,
      type: p.type || "",
      note_pt: p.note_pt || "",
      note_en: p.note_en || "",
      summary_pt: stripHtml(p.description_pt),
      summary_en: stripHtml(p.description_en),
      tags: asList(p.tags),
    }))
  );
  return roles.sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

export function shapeEducation(records) {
  return (records || [])
    .map((r) => ({
      years: `${year(r.start)} — ${year(r.end)}`,
      degree_pt: r.course_pt || r.course,
      degree_en: r.course_en || r.course,
      school_pt: r.name_pt || r.name,
      school_en: r.name_en || r.name,
      areas: asList(r.areas),
      order: r.order || 99,
    }))
    .sort((a, b) => a.order - b.order);
}

/* --- posts: the blog and the projects are one model ----------------------- */

/**
 * Where a post lives on the site.
 *
 * `type` is the only thing separating a project from a blog entry, and it maps
 * straight onto the two endpoints that already existed. A type with no route
 * of its own falls back to /blog/, so adding a `talk` or `paper` value in
 * PocketBase gives a working page before any frontend change.
 */
export const POST_ROUTES = { project: "/projects/", blog: "/blog/" };

export const postRoute = (type) => POST_ROUTES[type] || POST_ROUTES.blog;
export const postHref = (post) => `${postRoute(post.type)}${post.slug}/`;

export function shapeVolunteering(orgs) {
  return (orgs || [])
    .flatMap((org) =>
      shown(org.expand?.positions).map((p) => ({
        organisation: org.name_en || org.instituition,
        role_pt: p.title_pt,
        role_en: p.title_en,
        start: p.start,
        end: p.end || null,
        summary_pt: stripHtml(p.description_pt),
        summary_en: stripHtml(p.description_en),
      }))
    )
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

/**
 * One shape for every post, whatever its type.
 *
 * `body_pt/en` come through as **raw markdown**, not stripped and not parsed.
 * That is deliberate: `js/core/markdown.js` renders it in the browser, and the
 * prerenderer wants the source so it can derive plain text for a meta
 * description. Running `stripHtml` here would corrupt it — markdown is not
 * HTML, and `#`, `|` and `<` all mean something.
 *
 * Sorted newest first, but `order` wins when it is set, so a project can be
 * pinned to the top of the tree regardless of date.
 */
export function shapePosts(records) {
  return (records || [])
    .map((r) => {
      const cover = fileRef(r, "cover", "1600x0");
      const post = {
        id: r.id,
        type: r.type || "blog",
        slug: r.slug || slugify(r.title_en || r.title_pt || ""),
        date: day(r.date),
        order: r.order || 99,
        title_pt: r.title_pt || "",
        title_en: r.title_en || "",
        description_pt: r.description_pt || "",
        description_en: r.description_en || "",
        // Raw markdown. Rendered by core/markdown.js, never by innerHTML.
        body_pt: r.body_pt || "",
        body_en: r.body_en || "",
        cover,
        coverThumb: fileRef(r, "cover", "480x0"),
        // Unresized. The home tile shows the cover at full quality.
        coverFull: fileRef(r, "cover"),
        link: r.link || "",
        tags: asList(r.tags),
        seo: {
          title_pt: r.seo_title_pt || "",
          title_en: r.seo_title_en || "",
          description_pt: r.seo_description_pt || "",
          description_en: r.seo_description_en || "",
          keywords: r.seo_keywords || "",
          // The social card falls back to the cover: one image is better than
          // none, and most posts will never get a purpose-made card.
          ogImage: fileRef(r, "og_image", "1600x0") || cover,
          noindex: Boolean(r.noindex),
        },
      };
      post.href = postHref(post);
      return post;
    })
    .sort(
      (a, b) => a.order - b.order || String(b.date).localeCompare(String(a.date))
    );
}

/** The posts of one type, in render order. */
export const postsOfType = (posts, type) =>
  (posts || []).filter((p) => p.type === type);

export function shapePhotos(records) {
  return (records || []).map((r) => ({
    id: r.id,
    src: fileRef(r, "image", "1600x0"),
    thumb: fileRef(r, "image", "480x0"),
    alt_pt: r.caption_pt || "",
    alt_en: r.caption_en || "",
    place: r.place || "",
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    date: day(r.taken_at),
    album: r.album || "",
    stage: r.stage || "",
    trip: r.trip || "",
  }));
}

/** Cluster photos by place name, or by rounded coordinates when unnamed. */
export function groupPhotosByPlace(photos) {
  const places = new Map();
  for (const p of photos) {
    if (p.lat == null || p.lon == null) continue;
    const key = p.place || `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;
    if (!places.has(key)) {
      places.set(key, { name: key, lat: p.lat, lon: p.lon, photos: [] });
    }
    places.get(key).photos.push(p);
  }
  return [...places.values()].sort((a, b) => b.photos.length - a.photos.length);
}

/** Nest stages under their trip, and attach any stage photos. */
export function shapeTrips(trips, stages, photos = []) {
  const photosByStage = new Map();
  for (const p of photos) {
    if (!p.stage) continue;
    if (!photosByStage.has(p.stage)) photosByStage.set(p.stage, []);
    photosByStage.get(p.stage).push(p);
  }

  const stagesByTrip = new Map();
  for (const s of stages || []) {
    if (!stagesByTrip.has(s.trip)) stagesByTrip.set(s.trip, []);
    stagesByTrip.get(s.trip).push(s);
  }

  return (trips || [])
    .map((t) => ({
      id: t.slug,
      recordId: t.id,
      title: t.title,
      mode: t.mode || "cycling",
      year: t.year,
      order: t.order || 99,
      dates: t.dates,
      startedAt: t.started || null,
      endedAt: t.ended || null,
      region: t.region || "",
      story_pt: stripHtml(t.story_pt),
      story_en: stripHtml(t.story_en),
      cover: fileRef(t, "cover", "1600x0"),
      distanceKm: t.distance_km || 0,
      climbM: t.climb_m || 0,
      days: t.days || 0,
      bbox: asJson(t.bbox, null),
      stages: (stagesByTrip.get(t.id) || [])
        .map((s) => ({
          id: s.id,
          track: s.track,
          order: s.order || 99,
          number: s.number || null,
          name: s.name,
          description_pt: stripHtml(s.description_pt),
          description_en: stripHtml(s.description_en),
          distanceKm: s.distance_km || 0,
          climbM: s.climb_m || 0,
          descentM: s.descent_m || 0,
          minEleM: s.min_ele_m ?? null,
          maxEleM: s.max_ele_m ?? null,
          startedAt: s.started || null,
          endedAt: s.ended || null,
          elapsedHours: s.elapsed_hours ?? null,
          final: Boolean(s.is_final),
          bbox: asJson(s.bbox, null),
          profile: asJson(s.profile, []),
          // Where the geometry lives: a file on this record.
          trackFile: fileRef(s, "track_file"),
          photos: photosByStage.get(s.id) || [],
        }))
        .sort((a, b) => a.order - b.order),
    }))
    .sort((a, b) => a.order - b.order);
}

export function shapeSeo(records) {
  return Object.fromEntries(
    (records || []).map((r) => [
      r.page,
      {
        title_pt: r.title_pt || "",
        title_en: r.title_en || "",
        description_pt: r.description_pt || "",
        description_en: r.description_en || "",
        keywords: r.keywords || "",
        ogImage: fileRef(r, "og_image", "1600x0"),
        noindex: Boolean(r.noindex),
      },
    ])
  );
}

/* --- file references ------------------------------------------------------- */

/**
 * A host-less path into PocketBase's file endpoint. The caller prefixes the
 * backend origin, so the same shape works against localhost and production.
 */
export function fileRef(record, field, thumb) {
  if (!record?.[field]) return "";
  const p = `api/files/${record.collectionId}/${record.id}/${record[field]}`;
  return thumb ? `${p}?thumb=${thumb}` : p;
}

export const slugify = (s = "") =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
