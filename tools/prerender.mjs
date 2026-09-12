#!/usr/bin/env node
/**
 * Write the content into the HTML at build time, for crawlers.
 *
 * The pages are otherwise JS-rendered. Google will execute that, but slowly and
 * with no guarantees, and nothing else will: Bing, DuckDuckBot, LinkedIn,
 * WhatsApp, Slack and Mastodon previews all read the raw HTML only. So the
 * facts, the headings and the meta tags are baked in here, and the JavaScript
 * enhances what is already on the page rather than creating it.
 *
 * Scope: the <head>, the sitemap, and one generated shell per post.
 *
 * The generated shells are what make per-post SEO possible. A crawler is
 * handed one file per URL, so a post can only carry its own title and
 * description if it has its own address. Each published post therefore gets
 * /blog/<slug>/index.html or /projects/<slug>/index.html, copied from
 * `tools/post-shell.html` with only the <head> filled in — the body stays the
 * same static shell and fetches its content at runtime, like every other page.
 *
 * Those files are generated at deploy time and never committed; `.gitignore`
 * keeps them out. The repo still ships no content.
 *
 * An earlier version also injected rendered content into `data-prerender`
 * shells in the body. That was removed: it matched closing tags with a regex,
 * which silently corrupts the document as soon as the injected markup nests
 * the same tag, and re-running duplicated the blocks. Rewriting HTML needs a
 * real parser, and the head — where the SEO value actually is — needs none.
 *
 * Writes:
 *   - <title>, description, keywords, canonical, Open Graph, Twitter cards
 *   - JSON-LD structured data (Person, WebSite, ItemList, TouristTrip, Blog)
 *   - sitemap.xml and robots.txt
 *
 * Idempotent: re-running replaces its own output rather than nesting it.
 *
 * Usage  node tools/prerender.mjs [--origin https://example.com]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  shapeProfile, shapeExperience, shapeEducation,
  shapePosts, postsOfType, postRoute, shapeTrips, shapeSeo, shapePhotos,
  contactHref, profileUrls,
} from "../js/core/normalize.js";
import { markdownToText } from "../js/core/markdown.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};

const ORIGIN = (arg("origin", "https://franciscoribeiro2003.github.io")).replace(/\/$/, "");
const LANG = "en";
const LENIENT = args.includes("--lenient");

/**
 * The backend URL.
 *
 * CI sets `POCKETBASE_URL` from a secret. Locally it is already written in
 * `js/config.js` — the same file the browser reads — so fall back to that
 * rather than making every local run remember an environment variable.
 */
function backendUrl() {
  const fromEnv = (process.env.POCKETBASE_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  try {
    const config = readFileSync(path.join(ROOT, "js/config.js"), "utf8");
    const match = config.match(/pocketbaseUrl\s*:\s*["'`]([^"'`]+)["'`]/);
    if (match?.[1]) return match[1].trim().replace(/\/$/, "");
  } catch {
    /* no local config — CI, or a fresh clone */
  }
  return "";
}

const PB = backendUrl();

/**
 * The favicon URL, versioned by the icon's own bytes.
 *
 * Browsers keep favicons in a store separate from the normal HTTP cache: it
 * ignores `Cache-Control`, survives a hard reload, and in Chrome is keyed by
 * page URL rather than by the icon's freshness. So replacing `favicon.ico`
 * leaves the old icon on screen more or less indefinitely, which is exactly
 * what happened here.
 *
 * A content hash in the query gives a changed icon a new URL, which is a
 * different cache key, so it is fetched. It only changes when the file does,
 * so an unchanged icon stays cached across deploys.
 *
 * Falls back to the bare path if the file is missing — browsers probe
 * `/favicon.ico` at the site root anyway, so the link is an override rather
 * than the only route to it.
 */
function faviconHref() {
  try {
    const bytes = readFileSync(path.join(ROOT, "favicon.ico"));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    return `/favicon.ico?v=${hash}`;
  } catch {
    return "/favicon.ico";
  }
}
const FAVICON = faviconHref();

const PAGES = [
  { key: "home", file: "index.html", route: "/", priority: "1.0" },
  { key: "projects", file: "projects/index.html", route: "/projects/", priority: "0.9" },
  { key: "map", file: "map/index.html", route: "/map/", priority: "0.9" },
  { key: "photography", file: "photography/index.html", route: "/photography/", priority: "0.8" },
  { key: "blog", file: "blog/index.html", route: "/blog/", priority: "0.7" },
];

/* --- helpers -------------------------------------------------------------- */

const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** First sentence(s) up to `max`, cut on a word boundary. */
function clamp(text = "", max = 160) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "") + "…";
}

const pick = (obj, field) => obj?.[`${field}_${LANG}`] || obj?.[`${field}_en`] || obj?.[field] || "";

/**
 * Drop keys whose value is empty, recursively, and the object itself if that
 * leaves nothing but `@type`.
 *
 * Everything in the structured data is now read from the database, so any
 * field can legitimately be blank. `"jobTitle": ""` or an address with no city
 * is a worse signal to a consumer than the key simply not being there.
 */
function omitEmpty(value) {
  if (Array.isArray(value)) {
    const items = value.map(omitEmpty).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
      const cleaned = omitEmpty(raw);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    const meaningful = Object.keys(out).filter((k) => k !== "@type" && k !== "@id");
    return meaningful.length ? out : undefined;
  }
  if (value === "" || value === null || value === undefined) return undefined;
  return value;
}

/**
 * JSON for embedding in a `<script>` element.
 *
 * An HTML parser ends a script at the first `</script>` in the raw text,
 * whatever the JSON quoting says. So a post whose body merely *mentions* a
 * closing script tag — entirely normal in a technical blog — would cut the
 * JSON-LD in half and spill the remainder into the document as live markup.
 * A post containing `<img onerror=…>` would spill that.
 *
 * `<\/` is the fix: it is identical to `</` once the JSON string is parsed, so
 * the structured data is unchanged, but the HTML parser no longer sees a tag.
 * `<!--` gets the same treatment, since it can start a comment that swallows
 * the rest of the element.
 */
const jsonForScriptElement = (value) =>
  JSON.stringify(value, null, 2)
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--");

/**
 * An absolute URL for a file reference.
 *
 * `normalize.js` returns host-less `api/files/...` paths so the same shape
 * works against localhost and production. A social card has to be absolute —
 * a relative og:image is ignored — so the backend origin goes back on here.
 */
const absoluteMedia = (ref) =>
  !ref ? "" : /^https?:\/\//i.test(ref) ? ref : `${PB}/${String(ref).replace(/^\//, "")}`;

/**
 * Replace the content between a pair of HTML comments, inserting the block if
 * the markers are not there yet. Keeps repeated runs from nesting.
 */
function replaceBlock(html, name, content) {
  const open = `<!-- ${name}:start -->`;
  const close = `<!-- ${name}:end -->`;
  const block = `${open}\n${content}\n  ${close}`;
  const start = html.indexOf(open);
  if (start === -1) return { html, inserted: false };
  const end = html.indexOf(close, start);
  return {
    html: html.slice(0, start) + block + html.slice(end + close.length),
    inserted: true,
  };
}

/* --- head ----------------------------------------------------------------- */

/**
 * The `<head>` block.
 *
 * `author`, `og:site_name` and the fallback `og:image` come from the `webpage`
 * record via `profile`, not from literals — the site's owner is data like
 * everything else.
 */
function headBlock({ title, description, keywords, route, ogImage, noindex, type = "website", profile = {} }) {
  const url = `${ORIGIN}${route}`;
  // Falls back to the profile portrait: one image beats no preview card.
  const image = ogImage || absoluteMedia(profile.portraitFull);
  const owner = profile.name || "";
  const lines = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    keywords && `<meta name="keywords" content="${esc(keywords)}">`,
    owner && `<meta name="author" content="${esc(owner)}">`,
    // Search-engine ownership tokens, from webpage.site_verification.
    ...Object.entries(profile.siteVerification || {})
      .filter(([n, c]) => n && c)
      .map(([n, c]) => `<meta name="${esc(n)}" content="${esc(c)}">`),
    noindex && `<meta name="robots" content="noindex, nofollow">`,
    !noindex && `<meta name="robots" content="index, follow, max-image-preview:large">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="icon" href="${FAVICON}" sizes="16x16 32x32 48x48">`,
    ``,
    `<meta property="og:type" content="${type}">`,
    owner && `<meta property="og:site_name" content="${esc(owner)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${url}">`,
    image && `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:locale:alternate" content="pt_PT">`,
    ``,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    image && `<meta name="twitter:image" content="${esc(image)}">`,
  ].filter(Boolean);
  return lines.map((l) => (l ? `  ${l}` : "")).join("\n");
}

/**
 * JSON-LD. One Person graph plus whatever the page itself is.
 *
 * Every value is derived from PocketBase. Nothing about Francisco is written
 * here: the name, job title and city come from the `webpage` record, the email
 * and profile links from its `contacts` list, the schools from `education`,
 * the employers from `experience`, the topics from `skill_groups`, and the
 * languages from `spoken_languages`. Adding a profile link in the admin UI
 * puts it in `sameAs` on the next deploy, with no commit.
 *
 * `omitEmpty` drops keys that came back blank rather than publishing
 * `"jobTitle": ""` — an empty value is a worse signal than a missing one.
 */
function jsonLd(pageKey, content, trips) {
  const profile = content.profileExtras || {};
  const siteName = profile.name || "";

  const person = omitEmpty({
    "@type": "Person",
    "@id": `${ORIGIN}/#person`,
    name: profile.name,
    url: `${ORIGIN}/`,
    jobTitle: pick(profile, "jobTitle"),
    description: pick(profile, "tagline"),
    image: absoluteMedia(profile.portraitFull),
    email: contactHref(profile.contacts, /^mailto:/i),
    telephone: contactHref(profile.contacts, /^tel:/i),
    address: omitEmpty({
      "@type": "PostalAddress",
      addressLocality: profile.locality,
      addressCountry: profile.country,
    }),
    sameAs: profileUrls(profile.contacts),
    knowsLanguage: (content.languages || []).map((l) => pick(l, "name")).filter(Boolean),
    alumniOf: (content.education || [])
      .map((e) => pick(e, "school"))
      .filter(Boolean)
      .map((name) => ({ "@type": "EducationalOrganization", name })),
    worksFor: (content.experience || [])
      .filter((r) => !r.end && r.company)
      .map((r) => ({ "@type": "Organization", name: r.company })),
    knowsAbout: (profile.skillGroups || []).flatMap((g) => g.items || []),
  });

  const graph = [person];

  if (pageKey === "home") {
    graph.push(
      omitEmpty({
        "@type": "WebSite",
        "@id": `${ORIGIN}/#website`,
        url: `${ORIGIN}/`,
        name: siteName,
        inLanguage: ["en", "pt"],
        publisher: { "@id": `${ORIGIN}/#person` },
      })
    );
  }

  if (pageKey === "projects") {
    graph.push({
      "@type": "ItemList",
      name: "Projects",
      itemListElement: (content.projects || []).map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${ORIGIN}${p.href}`,
        item: {
          "@type": "CreativeWork",
          "@id": `${ORIGIN}${p.href}#work`,
          name: pick(p, "title"),
          url: `${ORIGIN}${p.href}`,
          abstract: clamp(pick(p, "description") || markdownToText(pick(p, "body")), 300),
          author: { "@id": `${ORIGIN}/#person` },
          ...(p.tags?.length ? { keywords: p.tags.join(", ") } : {}),
          ...(/github\.com/i.test(p.link) ? { codeRepository: p.link } : {}),
        },
      })),
    });
  }

  if (pageKey === "map") {
    graph.push({
      "@type": "ItemList",
      name: "Bikepacking trips",
      itemListElement: trips.map((t, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "TouristTrip",
          name: t.title,
          description: pick(t, "story") || `${t.stages.length} stages, ${t.distanceKm} km`,
          ...(t.startedAt ? { startDate: t.startedAt.slice(0, 10) } : {}),
          ...(t.endedAt ? { endDate: t.endedAt.slice(0, 10) } : {}),
          itinerary: t.stages.map((s) => ({ "@type": "Place", name: s.name })),
        },
      })),
    });
  }

  if (pageKey === "blog") {
    graph.push({
      "@type": "Blog",
      "@id": `${ORIGIN}/blog/#blog`,
      name: pick(content.seo?.blog || {}, "title") || "Blog",
      author: { "@id": `${ORIGIN}/#person` },
      blogPost: (content.blog || []).map((p) => ({
        "@type": "BlogPosting",
        "@id": `${ORIGIN}${p.href}#post`,
        headline: pick(p, "title"),
        description: pick(p, "description"),
        datePublished: p.date || undefined,
        url: `${ORIGIN}${p.href}`,
        author: { "@id": `${ORIGIN}/#person` },
      })),
    });
  }

  /**
   * A single post's own page.
   *
   * `BlogPosting` for a blog entry and `CreativeWork` for a project, because
   * the two are genuinely different things to a search engine even though they
   * share a row shape. `articleBody` carries the markdown as plain text — the
   * one place where body content reaches the HTML, and it belongs there: it is
   * what tells a crawler the page is about something.
   */
  if (pageKey === "post") {
    const post = content.post;
    const isBlog = post.type === "blog";
    const body = markdownToText(pick(post, "body"));
    graph.push({
      "@type": isBlog ? "BlogPosting" : "CreativeWork",
      "@id": `${ORIGIN}${post.href}#${isBlog ? "post" : "work"}`,
      headline: pick(post, "title"),
      name: pick(post, "title"),
      description: clamp(pick(post, "description") || body, 300),
      url: `${ORIGIN}${post.href}`,
      inLanguage: LANG,
      author: { "@id": `${ORIGIN}/#person` },
      ...(isBlog ? { publisher: { "@id": `${ORIGIN}/#person` } } : {}),
      ...(post.date ? { datePublished: post.date } : {}),
      ...(post.tags?.length ? { keywords: post.tags.join(", ") } : {}),
      ...(post.seo.ogImage ? { image: absoluteMedia(post.seo.ogImage) } : {}),
      ...(body ? { articleBody: clamp(body, 5000) } : {}),
      ...(/github\.com/i.test(post.link) ? { codeRepository: post.link } : {}),
      ...(isBlog && post.link ? { sameAs: post.link } : {}),
      ...(isBlog
        ? { isPartOf: { "@id": `${ORIGIN}/blog/#blog` } }
        : { isPartOf: { "@id": `${ORIGIN}/projects/` } }),
    });
  }

  return (
    `  <script type="application/ld+json">\n` +
    jsonForScriptElement({ "@context": "https://schema.org", "@graph": graph })
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n") +
    `\n  </script>`
  );
}

/* --- main ----------------------------------------------------------------- */

/**
 * Read the site's content straight from PocketBase.
 *
 * The pages fetch this at runtime; the prerenderer needs it at build time
 * because a crawler reads <head> before any JavaScript runs. Same collections,
 * same shaping functions — one source of truth, two consumers.
 */
async function loadFromBackend() {
  if (!PB) return null;
  const get = async (collection, query = "") => {
    const res = await fetch(
      `${PB}/api/collections/${collection}/records?perPage=500${query}`,
      { signal: AbortSignal.timeout(25000) }
    );
    if (!res.ok) throw new Error(`${collection}: ${res.status}`);
    return (await res.json()).items || [];
  };
  const optional = (c, q) => get(c, q).catch(() => []);

  const [webpage, experience, education, posts, photos, seo, languages, trips, stages] =
    await Promise.all([
      optional("webpage"),
      optional("experience", "&expand=positions"),
      optional("education", "&sort=-start"),
      // One collection for the blog and the projects, as in the browser.
      optional("posts", "&sort=order,-date&filter=(published=true)"),
      optional("photos", "&filter=(published=true)"),
      optional("page_seo"),
      optional("spoken_languages"),
      optional("trips", "&sort=order&filter=(published=true)"),
      optional("stages", "&sort=order"),
    ]);

  const allPosts = shapePosts(posts);

  return {
    content: {
      profile: shapeProfile(webpage[0]),
      profileExtras: shapeProfile(webpage[0]) || {},
      experience: shapeExperience(experience),
      education: shapeEducation(education),
      posts: allPosts,
      projects: postsOfType(allPosts, "project"),
      blog: postsOfType(allPosts, "blog"),
      // Feeds schema.org knowsLanguage. It was hardcoded to [] and the
      // collection was never read.
      languages,
      photos: shapePhotos(photos),
      seo: shapeSeo(seo),
    },
    trips: shapeTrips(trips, stages, shapePhotos(photos)),
  };
}

/* --- generated per-post pages --------------------------------------------- */

/**
 * Write one shell per post, with its own <head>.
 *
 * The shell's body is not touched — only the seo/jsonld blocks and the two
 * `data-post-*` attributes that tell `js/pages/post.js` what to fetch. Those
 * attributes are the one exception to head-only editing, and a deliberate one:
 * they are two short identifiers in the opening `<body>` tag, matched by an
 * anchored pattern on a tag this template is known to contain exactly once —
 * not a general-purpose HTML rewrite.
 */
async function writePostPages(shellHtml, content, trips) {
  const written = [];
  const skipped = [];

  for (const post of content.posts) {
    if (!post.slug) {
      skipped.push(`(no slug: ${post.id})`);
      continue;
    }

    const seo = post.seo;
    const body = markdownToText(pick(post, "body"));
    const owner = content.profileExtras?.name || "";
    const title =
      seo[`title_${LANG}`] || seo.title_en ||
      [pick(post, "title"), owner].filter(Boolean).join(" — ");
    const description = clamp(
      seo[`description_${LANG}`] || seo.description_en ||
        pick(post, "description") || body,
      200
    );

    let html = shellHtml;

    html = replaceBlock(
      html,
      "seo",
      headBlock({
        title,
        description,
        keywords: seo.keywords,
        route: post.href,
        ogImage: absoluteMedia(seo.ogImage),
        noindex: seo.noindex,
        type: post.type === "blog" ? "article" : "website",
        profile: content.profileExtras,
      })
    ).html;

    html = replaceBlock(
      html,
      "jsonld",
      jsonLd("post", { ...content, post }, trips)
    ).html;

    // Tell the page module which record to render.
    html = html.replace(
      /<body\s+data-post-type="[^"]*"\s+data-post-slug="[^"]*">/,
      `<body data-post-type="${esc(post.type)}" data-post-slug="${esc(post.slug)}">`
    );
    if (!html.includes(`data-post-slug="${post.slug}"`)) {
      throw new Error(
        `post-shell.html: could not stamp the <body> attributes for "${post.slug}". ` +
          `The opening <body> tag must stay as ` +
          `<body data-post-type="…" data-post-slug="…"> on one line.`
      );
    }

    const dir = path.join(ROOT, postRoute(post.type).replace(/^\//, ""), post.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), html);
    written.push({ route: post.href, title: title.length, description: description.length });
  }

  return { written, skipped };
}

async function main() {
  if (!PB) {
    console.error(
      "No backend URL: POCKETBASE_URL is unset and js/config.js has no\n" +
        "pocketbaseUrl.\n" +
        "The SEO block is generated from the page_seo records in PocketBase, so\n" +
        "this needs to reach the backend. Set POCKETBASE_URL and run again."
    );
    process.exit(1);
  }

  /**
   * Reaching the backend is now a hard requirement.
   *
   * This used to exit 0 and leave the committed HTML alone, on the grounds
   * that stale meta tags beat empty ones. That reasoning inverted when the
   * generated blocks were emptied out of the repo: there is no longer a
   * committed `<head>` to fall back on, so continuing would publish five pages
   * with no title, no description and no card. Failing the deploy leaves the
   * previous, working `gh-pages` build serving.
   *
   * The retry is for the cold start: the service scales to zero, so the first
   * request after an idle period can time out while the instance boots.
   */
  let data;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      data = await loadFromBackend();
      break;
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        console.warn(`PocketBase unreachable (${err.message}) — retry ${attempt}/2 in 5s`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
  if (!data) {
    console.error(
      `\nPocketBase unreachable after 3 attempts: ${lastError?.message}\n\n` +
        `The <head> blocks in this repo are intentionally empty — the content\n` +
        `lives in PocketBase and is baked in here at deploy time.\n`
    );
    if (LENIENT) {
      console.error(
        `--lenient: carrying on. The dev server will start, but the per-post\n` +
          `pages will not exist and /projects/<slug>/ will 404. Start the\n` +
          `backend (cd ../fribeiro && npm run pb) and re-run.\n`
      );
      process.exit(0);
    }
    console.error(
      `Publishing now would ship pages with no title, so this fails instead,\n` +
        `and the previous deploy keeps serving.\n`
    );
    process.exit(1);
  }
  const { content, trips } = data;
  const seoRecords = content.seo || {};

  // Used only when a `page_seo` record has no description. Every one of the
  // five is populated, so in practice these never fire — they exist so a page
  // added later is not published with an empty meta description. They are
  // derived, never written copy: the profile tagline, or a count of what the
  // page actually contains.
  const fallbackDescriptions = {
    home: pick(content.profileExtras, "tagline"),
    projects: `${content.projects.length} projects.`,
    map: `${trips.length} bikepacking trips, ${trips.reduce((n, t) => n + t.stages.length, 0)} stages, ${trips.reduce((n, t) => n + t.distanceKm, 0)} km.`,
    photography: `${(content.photos || []).length} photographs.`,
    blog: `${content.blog.length} posts.`,
  };

  const report = [];

  for (const page of PAGES) {
    const file = path.join(ROOT, page.file);
    let html = await readFile(file, "utf8");
    const seo = seoRecords[page.key] || {};

    const title =
      seo[`title_${LANG}`] || seo.title_en || content.profileExtras?.name || "";
    const description = clamp(
      seo[`description_${LANG}`] || seo.description_en || fallbackDescriptions[page.key],
      200
    );

    const head = headBlock({
      title,
      description,
      keywords: seo.keywords,
      route: page.route,
      ogImage: absoluteMedia(seo.ogImage),
      noindex: seo.noindex,
      type: page.key === "blog" ? "blog" : "website",
      profile: content.profileExtras,
    });

    const headResult = replaceBlock(html, "seo", head);
    html = headResult.html;
    const ldResult = replaceBlock(html, "jsonld", jsonLd(page.key, content, trips));
    html = ldResult.html;

    await writeFile(file, html);
    report.push({
      page: page.key,
      head: headResult.inserted,
      jsonld: ldResult.inserted,
      title: title.length,
      description: description.length,
    });
  }

  /* --- one page per post -------------------------------------------------- */

  const shellHtml = await readFile(path.join(ROOT, "tools/post-shell.html"), "utf8");
  const posts = await writePostPages(shellHtml, content, trips);

  /* --- sitemap + robots --------------------------------------------------- */

  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ...PAGES.filter((p) => !seoRecords[p.key]?.noindex).map((p) => ({
      loc: `${ORIGIN}${p.route}`,
      priority: p.priority,
    })),
    // Each post's own URL. `noindex` posts are excluded here as well as in
    // their <head> — a sitemap entry for a page you asked not to index is a
    // contradiction crawlers report as an error.
    ...content.posts
      .filter((p) => p.slug && !p.seo.noindex)
      .map((p) => ({
        loc: `${ORIGIN}${p.href}`,
        priority: p.type === "project" ? "0.8" : "0.6",
      })),
  ];

  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join("\n") +
    `\n</urlset>\n`;
  await writeFile(path.join(ROOT, "sitemap.xml"), sitemap);
  await writeFile(
    path.join(ROOT, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`
  );

  /* --- report ------------------------------------------------------------- */

  console.log("page          head  json-ld  title  description");
  for (const r of report) {
    const warn = r.title > 60 ? " \u26a0 title >60" : r.description > 160 ? " \u26a0 desc >160" : "";
    console.log(
      `${r.page.padEnd(13)} ${r.head ? " ok " : "MISS"}  ${r.jsonld ? "  ok  " : " MISS "}  ` +
        `${String(r.title).padStart(5)}  ${String(r.description).padStart(11)}${warn}`
    );
  }
  if (posts.written.length) {
    console.log("\ngenerated post pages");
    for (const p of posts.written) {
      const warn =
        p.title > 60 ? " ⚠ title >60" : p.description > 160 ? " ⚠ desc >160" : "";
      console.log(
        `  ${p.route.padEnd(44)} ${String(p.title).padStart(3)}  ` +
          `${String(p.description).padStart(3)}${warn}`
      );
    }
  }
  for (const s of posts.skipped) console.log(`  skipped ${s}`);

  console.log(
    `\nfrom ${PB} — ${content.projects.length} projects, ${content.blog.length} blog posts, ` +
      `${trips.length} trips`
  );
  console.log(
    `${urls.length} urls in sitemap.xml; robots.txt written for ${ORIGIN}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
