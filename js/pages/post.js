import { initSite, el, $, t, state, translateDom } from "../core/site.js";
import { loadContent, mediaUrl } from "../core/data.js";
import { mountMarkdown } from "../core/markdown.js";
import { postRoute } from "../core/normalize.js";

/**
 * One post, whatever its type.
 *
 * Serves both /blog/<slug>/ and /projects/<slug>/ — the generated shell says
 * which via `data-post-type` and `data-post-slug`, and the slug falls back to
 * the last path segment so the page still works if the attribute is empty.
 *
 * It reads the same `loadContent()` as every other page, which means the
 * cached copy a visitor already has covers this page too: arriving here from
 * the list costs no extra request.
 */

initSite();

const shell = document.body;
const TYPE = shell.dataset.postType || "blog";
const SLUG =
  shell.dataset.postSlug ||
  location.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() ||
  "";

let post = null;

function localized(obj, field) {
  return obj[`${field}_${state.lang}`] || obj[`${field}_en`] || obj[`${field}_pt`] || "";
}

/** A date the reader's locale recognises, from the stored YYYY-MM-DD. */
function readableDate(iso) {
  if (!iso) return "";
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return iso;
  return parsed.toLocaleDateString(state.lang === "pt" ? "pt-PT" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The label for an outbound link, from its host. */
function linkLabel(href) {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "");
    const known = {
      "github.com": "GitHub",
      "youtube.com": "YouTube",
      "youtu.be": "YouTube",
      "medium.com": "Medium",
      "linkedin.com": "LinkedIn",
    };
    return known[host] || host;
  } catch {
    return t("post.visit");
  }
}

/* --- render --------------------------------------------------------------- */

function renderMissing() {
  $("#entry").replaceChildren(
    el("p", { class: "crumb", text: `${postRoute(TYPE).replace(/\//g, "")} / ${SLUG}` }),
    el("h1", { class: "t-h1", text: t("post.missing.title") }),
    el("p", { class: "t-body-l secondary", text: t("post.missing.body") }),
    el("p", {}, [
      el("a", {
        class: "t-mono-s accent",
        href: postRoute(TYPE),
        text: t(TYPE === "project" ? "post.allProjects" : "post.allPosts"),
      }),
    ])
  );
  $("#entry").setAttribute("aria-busy", "false");
}

function render() {
  const host = $("#entry");
  if (!post) return renderMissing();

  const title = localized(post, "title");
  const description = localized(post, "description");
  const body = localized(post, "body");

  const parts = [
    /* a terminal-style breadcrumb, as on the other pages */
    el("p", { class: "crumb" }, [
      el("a", {
        class: "crumb__link",
        href: postRoute(TYPE),
        text: postRoute(TYPE).replace(/\//g, ""),
      }),
      el("span", { text: " / " }),
      el("span", { text: post.slug }),
    ]),

    el("h1", { class: "t-h1 entry__title", text: title }),
  ];

  const meta = [];
  if (post.date) {
    meta.push(el("time", { class: "entry__date", datetime: post.date, text: readableDate(post.date) }));
  }
  if (post.tags?.length) {
    if (meta.length) meta.push(el("span", { class: "sep", text: "·" }));
    meta.push(
      el(
        "span",
        { class: "entry__tags" },
        post.tags.map((tag) => el("span", { class: "tag", text: tag }))
      )
    );
  }
  if (meta.length) parts.push(el("p", { class: "entry__meta" }, meta));

  if (description) {
    parts.push(el("p", { class: "t-body-l secondary entry__lede", text: description }));
  }

  if (post.cover) {
    parts.push(
      el("figure", { class: "entry__cover" }, [
        el("img", {
          src: mediaUrl(post.cover),
          alt: title,
          loading: "lazy",
          decoding: "async",
        }),
      ])
    );
  }

  /* the markdown body */
  const article = el("div", { class: "markdown" });
  parts.push(article);

  if (post.link) {
    parts.push(
      el("p", { class: "entry__link" }, [
        el("a", {
          class: "t-mono-s accent nav__link--external",
          href: post.link,
          target: "_blank",
          rel: "noopener noreferrer",
          text: `${t("post.readOn")} ${linkLabel(post.link)}`,
        }),
      ])
    );
  }

  parts.push(
    el("p", { class: "entry__back" }, [
      el("a", {
        class: "t-mono-s accent",
        href: postRoute(TYPE),
        text: t(TYPE === "project" ? "post.allProjects" : "post.allPosts"),
      }),
    ])
  );

  host.replaceChildren(...parts.filter(Boolean));
  host.setAttribute("aria-busy", "false");

  // The body is rendered after the frame is in place, so a slow parse cannot
  // hold up the title and cover.
  if (!mountMarkdown(article, body)) article.remove();

  translateDom();
}

/* --- boot ----------------------------------------------------------------- */

/**
 * Wait for the deferred `marked` script.
 *
 * It is `defer`, so it has run by `DOMContentLoaded` — but this module is also
 * `type="module"` and therefore deferred itself, and the relative order of the
 * two is not something to rely on. A short poll is cheaper than being wrong,
 * and the page renders without a body rather than not at all if it never
 * arrives.
 */
function whenMarkedReady(timeoutMs = 4000) {
  if (globalThis.marked?.parse) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (globalThis.marked?.parse || Date.now() - started > timeoutMs) resolve();
      else setTimeout(tick, 40);
    };
    tick();
  });
}

async function boot() {
  const [content] = await Promise.all([
    loadContent((fresh) => {
      post = pick(fresh);
      render();
    }),
    whenMarkedReady(),
  ]);
  post = pick(content);
  render();
}

const pick = (content) =>
  (content?.posts || []).find((p) => p.slug === SLUG && p.type === TYPE) ||
  (content?.posts || []).find((p) => p.slug === SLUG) ||
  null;

boot();
document.addEventListener("langchange", render);
