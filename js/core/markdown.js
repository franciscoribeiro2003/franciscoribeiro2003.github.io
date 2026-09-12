/**
 * The markdown viewer for post bodies.
 *
 * `posts.body_pt/en` hold raw markdown, written in the PocketBase admin UI.
 * This turns it into a DOM fragment. Three jobs, in order:
 *
 *   1. Parse — `marked`, loaded by the page shell with an SRI hash.
 *   2. Harden — walk the parsed tree and delete anything not on an allowlist.
 *   3. Enhance — the things that make a body behave like part of this site
 *      rather than a dumped README: demoted headings, figures, lazy images,
 *      scroll containers for wide content, safe external links.
 *
 * Why parse then walk, rather than sanitise the HTML string: the string is
 * regex-hostile and I have already broken a document in this project by
 * matching closing tags with a regex. `DOMParser` gives a real tree from the
 * browser's own parser, and it is inert — scripts do not run and `onerror`
 * does not fire until a node is inserted into the live document. So the walk
 * happens while the tree is still detached, and only the cleaned result is
 * ever adopted.
 *
 * On images: the markdown may reference images, and they are expected to be
 * **external URLs** — nothing here is uploaded alongside the post. So an
 * `<img>` is only kept when its src is http(s), and it is then treated as a
 * third-party resource: lazy, async, no referrer leaked to the host, and
 * capped to the column width so a 4000px original cannot blow out the layout.
 */

/* --- what survives the walk ----------------------------------------------- */

const ALLOWED = new Set([
  "p", "br", "hr", "div", "span",
  "strong", "em", "b", "i", "u", "s", "del", "ins", "mark", "small",
  "sup", "sub", "abbr", "kbd", "code", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "details", "summary", "input",
]);

/** Per-tag attribute allowlist. Everything else goes, `on*` included. */
const ATTRS = {
  a: ["href", "title"],
  img: ["src", "alt", "title", "width", "height"],
  th: ["colspan", "rowspan", "align", "scope"],
  td: ["colspan", "rowspan", "align"],
  col: ["span"],
  colgroup: ["span"],
  ol: ["start", "reversed", "type"],
  li: ["value"],
  input: ["type", "checked", "disabled"],
  code: ["class"],
  pre: ["class"],
  details: ["open"],
};

const LINK_SCHEMES = /^(https?:|mailto:|tel:|#|\/)/i;
const IMAGE_SCHEMES = /^https?:\/\//i;

/* --- the hardening walk --------------------------------------------------- */

function harden(root) {
  // A static list: the walk removes and replaces nodes, and a live
  // TreeWalker over a mutating tree skips siblings.
  const elements = [...root.querySelectorAll("*")];

  for (const node of elements) {
    // Already removed as part of an ancestor.
    if (!node.isConnected && !root.contains(node)) continue;

    const tag = node.tagName.toLowerCase();

    if (!ALLOWED.has(tag)) {
      // Unwrap rather than delete, so the words inside a stray <font> or
      // <section> survive. `<script>`/`<style>` are the exception: their text
      // content is code, not prose, and must go with them.
      if (tag === "script" || tag === "style" || tag === "iframe" ||
          tag === "object" || tag === "embed" || tag === "template") {
        node.remove();
      } else {
        node.replaceWith(...node.childNodes);
      }
      continue;
    }

    const permitted = ATTRS[tag] || [];
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (!permitted.includes(name)) {
        node.removeAttribute(attr.name);
        continue;
      }
      // A permitted attribute can still carry a javascript: payload.
      if (name === "href" && !LINK_SCHEMES.test(attr.value.trim())) {
        node.removeAttribute(attr.name);
      }
      if (name === "src" && !IMAGE_SCHEMES.test(attr.value.trim())) {
        node.removeAttribute(attr.name);
      }
    }

    // A task-list checkbox is the only input markdown produces. Anything else
    // claiming to be an input is a form control in someone's prose.
    if (tag === "input") {
      if (node.getAttribute("type") !== "checkbox") node.remove();
      else node.setAttribute("disabled", "");
    }

    // An <img> whose src did not survive is a broken icon, not an image.
    if (tag === "img" && !node.getAttribute("src")) node.remove();
  }
}

/* --- the enhancement pass ------------------------------------------------- */

/**
 * Push every heading down by `offset` levels.
 *
 * The page already renders the post title as its `<h1>`. A body that opens
 * with its own `#` — every README does — would give the document two h1s,
 * which breaks the outline for a screen reader and muddies the SEO signal the
 * baked `<head>` is there to make clear. h1→h2, h2→h3, and h6 stays h6.
 */
function demoteHeadings(root, offset = 1) {
  for (const heading of [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")]) {
    const level = Number(heading.tagName[1]);
    const target = Math.min(6, level + offset);
    if (target === level) continue;
    const replacement = root.ownerDocument.createElement(`h${target}`);
    for (const attr of [...heading.attributes]) {
      replacement.setAttribute(attr.name, attr.value);
    }
    replacement.append(...heading.childNodes);
    heading.replaceWith(replacement);
  }
}

/** Wrap a node in a horizontally scrollable box, per the site's wide-content rule. */
function wrapScrollable(node, className) {
  const box = node.ownerDocument.createElement("div");
  box.className = className;
  node.replaceWith(box);
  box.append(node);
}

function enhance(root) {
  const doc = root.ownerDocument;

  demoteHeadings(root, 1);

  /* images: third-party by definition, so treat them as such */
  for (const img of [...root.querySelectorAll("img")]) {
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    img.setAttribute("referrerpolicy", "no-referrer");
    if (!img.getAttribute("alt")) img.setAttribute("alt", "");

    // An image alone in a paragraph is a block illustration; give it a
    // <figure> and promote its title (or alt) to a caption.
    const parent = img.parentElement;
    const alone =
      parent &&
      parent.tagName === "P" &&
      parent.childNodes.length === 1;
    if (!alone) continue;

    const figure = doc.createElement("figure");
    figure.className = "markdown__figure";
    figure.append(img);
    const caption = img.getAttribute("title") || "";
    if (caption) {
      const el = doc.createElement("figcaption");
      el.textContent = caption;
      figure.append(el);
      img.removeAttribute("title");
    }
    parent.replaceWith(figure);
  }

  /* links: anything leaving the site opens away from it and leaks nothing */
  const origin = typeof location === "undefined" ? "" : location.origin;
  for (const link of [...root.querySelectorAll("a[href]")]) {
    const href = link.getAttribute("href");
    const external = /^https?:\/\//i.test(href) && !href.startsWith(origin);
    if (external) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      link.classList.add("markdown__link--external");
    }
  }

  /* wide content scrolls inside itself; the page must never scroll sideways */
  for (const table of [...root.querySelectorAll("table")]) {
    wrapScrollable(table, "markdown__table");
  }
  for (const pre of [...root.querySelectorAll("pre")]) {
    pre.classList.add("markdown__pre");
  }

  /* task lists lose their bullet */
  for (const item of [...root.querySelectorAll("li")]) {
    if (item.querySelector(':scope > input[type="checkbox"]')) {
      item.classList.add("markdown__task");
    }
  }
}

/* --- entry points --------------------------------------------------------- */

let warned = false;

/**
 * Render markdown into a fragment, or null when there is nothing to show.
 *
 * Returns null rather than throwing when `marked` has not loaded, so a page
 * can fall back to showing the description instead of showing nothing.
 */
export function renderMarkdown(source) {
  const text = String(source || "").trim();
  if (!text) return null;

  const marked = globalThis.marked;
  if (!marked?.parse) {
    if (!warned) {
      warned = true;
      console.warn("[markdown] `marked` is not loaded — body not rendered.");
    }
    return null;
  }

  // `gfm` for tables and task lists; `breaks` off because a hard-wrapped
  // paragraph in the admin textarea should not become a stack of short lines.
  const html = marked.parse(text, { gfm: true, breaks: false });

  const parsed = new DOMParser().parseFromString(
    `<div id="md-root">${html}</div>`,
    "text/html"
  );
  const root = parsed.getElementById("md-root");

  harden(root);
  enhance(root);

  const fragment = document.createDocumentFragment();
  fragment.append(...document.adoptNode(root).childNodes);
  return fragment;
}

/** Render into `host`, returning whether anything was written. */
export function mountMarkdown(host, source) {
  if (!host) return false;
  const fragment = renderMarkdown(source);
  if (!fragment) return false;
  host.replaceChildren(fragment);
  return true;
}

/**
 * Plain text from markdown, for a meta description or a card.
 *
 * Deliberately crude and synchronous: it strips the markup it can and is used
 * only where a rough summary beats an empty string. Anything that matters for
 * SEO is written by hand into the `seo_*` fields.
 */
export function markdownToText(source, limit = 0) {
  let text = String(source || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/[*_~]{1,3}/g, "")
    // Markdown allows inline HTML, and a summary is plain text by definition.
    // Dropping the whole element for script/style/iframe, then any remaining
    // tag: their content is code or chrome, not prose. Doing this here also
    // keeps markup out of every meta description derived from a body.
    .replace(/<(script|style|iframe|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (limit > 0 && text.length > limit) {
    const cut = text.slice(0, limit);
    const at = cut.lastIndexOf(" ");
    text = `${(at > limit * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, "")}…`;
  }
  return text;
}
