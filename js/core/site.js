/**
 * Site chrome: theme, language, the terminal prompt, and the shared
 * navigation and footer. Every page imports `initSite()`.
 */

import { lookup } from "./i18n.js";

/**
 * The CV that ships with the site.
 *
 * `webpage.cv` in PocketBase overrides this whenever it holds a file, which is
 * the normal case — uploading a new CV in the admin UI publishes it without a
 * deploy. This copy is the floor: it keeps the link working when the record is
 * empty, and when the backend is unreachable or still cold, which is precisely
 * when a dead "CV" link in the nav would be most embarrassing.
 *
 * It is the one content file the repo keeps on purpose, for that reason.
 */
const FALLBACK_CV = "/assets/FranciscoRibeiro-CV.pdf";

/* --- small DOM helpers ---------------------------------------------------- */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Format a number the way the current locale expects (thin spaces, not commas). */
export function num(value, lang = state.lang) {
  return new Intl.NumberFormat(lang === "pt" ? "pt-PT" : "en-GB").format(value);
}

/* --- state ---------------------------------------------------------------- */

const STORE = { theme: "fr:theme", lang: "fr:lang" };

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the choice just will not persist */
  }
}

export const state = {
  theme: readStored(STORE.theme, "system"),
  lang: readStored(STORE.lang, "en"),
};

export function t(key, vars) {
  let out = lookup(state.lang, key);
  if (typeof out === "string" && vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  }
  return out;
}

/* --- theme ---------------------------------------------------------------- */

export function applyTheme(theme) {
  state.theme = theme;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  writeStored(STORE.theme, theme);
  document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

function resolvedTheme() {
  if (state.theme !== "system") return state.theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/* --- language ------------------------------------------------------------- */

export function applyLanguage(lang) {
  state.lang = lang;
  document.documentElement.lang = lang;
  writeStored(STORE.lang, lang);
  translateDom();
  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

export function translateDom(root = document) {
  $$("[data-i18n]", root).forEach((node) => {
    const value = t(node.dataset.i18n);
    if (typeof value !== "string") return;
    if (node.dataset.i18nAttr) node.setAttribute(node.dataset.i18nAttr, value);
    else node.textContent = value;
  });
}

/* --- terminal prompt ------------------------------------------------------ */

const ROUTES = [
  { path: "/", key: "home", prompt: "~", nav: null },
  { path: "/projects/", key: "projects", prompt: "~/projects", nav: "projects" },
  {
    path: "/photography/",
    key: "photography",
    prompt: "~/photography",
    nav: "photography",
  },
  { path: "/map/", key: "map", prompt: "~/map", nav: "map" },
  { path: "/blog/", key: "blog", prompt: "~/blog", nav: "blog" },
];

function currentRoute() {
  const here = window.location.pathname.replace(/index\.html$/, "");
  return (
    ROUTES.slice(1).find((r) => here.startsWith(r.path)) || ROUTES[0]
  );
}

/* --- chrome --------------------------------------------------------------- */

function buildNav(route) {
  const links = el("div", { class: "nav__links", id: "nav-links" }, [
    ...["projects", "photography", "map", "blog"].map((key) =>
      el("a", {
        class: "nav__link",
        href: `/${key}/`,
        "data-i18n": `nav.${key}`,
        ...(route.nav === key ? { "aria-current": "page" } : {}),
        text: t(`nav.${key}`),
      })
    ),
    el("a", {
      // Starts on the shipped copy; applyIdentity() swaps in the uploaded one
      // if there is one. Never hidden — the fallback always resolves.
      class: "nav__link nav__link--external",
      "data-cv-link": "",
      href: FALLBACK_CV,
      target: "_blank",
      rel: "noopener",
      "data-i18n": "nav.cv",
      text: t("nav.cv"),
    }),
  ]);

  const langSwitch = el("div", { class: "lang-switch" }, [
    el("button", {
      class: "lang-switch__opt",
      type: "button",
      "aria-pressed": String(state.lang === "en"),
      text: "EN",
      onclick: () => applyLanguage("en"),
      "data-lang": "en",
    }),
    el("span", { class: "lang-switch__sep", text: "/" }),
    el("button", {
      class: "lang-switch__opt",
      type: "button",
      "aria-pressed": String(state.lang === "pt"),
      text: "PT",
      onclick: () => applyLanguage("pt"),
      "data-lang": "pt",
    }),
  ]);

  const themeBtn = el("button", {
    class: "theme-toggle",
    type: "button",
    "aria-label": t("nav.theme"),
    "data-i18n": "nav.theme",
    "data-i18n-attr": "aria-label",
    text: "◐",
    onclick: () => applyTheme(resolvedTheme() === "dark" ? "light" : "dark"),
  });

  const menuBtn = el("button", {
    class: "nav__menu-btn",
    type: "button",
    "aria-label": t("nav.menu"),
    "aria-expanded": "false",
    "aria-controls": "nav-links",
    text: "≡",
  });
  menuBtn.addEventListener("click", () => {
    const open = menuBtn.getAttribute("aria-expanded") === "true";
    menuBtn.setAttribute("aria-expanded", String(!open));
    links.hidden = open;
  });

  // Collapsed by default on narrow screens; the media query hides the button
  // above 860px, where the links are always laid out inline.
  const mq = window.matchMedia("(max-width: 860px)");
  const syncMenu = () => {
    links.hidden = mq.matches && menuBtn.getAttribute("aria-expanded") !== "true";
  };
  mq.addEventListener("change", syncMenu);
  syncMenu();

  return el("header", { class: "nav" }, [
    el("div", { class: "nav__prompt" }, [
      // A real <a> on every page but home — clicking your own location in
      // the prompt is a no-op there, same reasoning a site logo would follow.
      el(
        route.key === "home" ? "span" : "a",
        {
          class: "nav__path",
          href: route.key === "home" ? null : "/",
          text: `fribeiro@home:${route.prompt}$`,
        }
      ),
      el("span", { class: "cursor", "aria-hidden": "true", text: "▮" }),
    ]),
    el("div", { class: "nav__controls" }, [
      links,
      el("span", { class: "nav__divider", "aria-hidden": "true" }),
      langSwitch,
      themeBtn,
      menuBtn,
    ]),
  ]);
}

function buildFooter() {
  const updated = document.documentElement.dataset.updated || "2026";
  return el("footer", { class: "footer" }, [
    el("div", { class: "footer__row" }, [
      el("div", { class: "footer__signoff" }, [
        el("span", { text: "fribeiro@home:~$" }),
        el("span", { class: "cmd", text: "exit" }),
        el("span", { class: "cursor", "aria-hidden": "true", text: "▮" }),
      ]),
      el(
        "nav",
        { class: "footer__links", "aria-label": "Footer" },
        [
          ...["projects", "photography", "map", "blog"].map((key) =>
            el("a", {
              href: `/${key}/`,
              "data-i18n": `nav.${key}`,
              text: t(`nav.${key}`),
            })
          ),
          el("a", {
            "data-cv-link": "",
            href: FALLBACK_CV,
            target: "_blank",
            rel: "noopener",
            class: "nav__link--external",
            "data-i18n": "nav.cv",
            text: t("nav.cv"),
          }),
        ]
      ),
    ]),
    el("div", { class: "footer__row" }, [
      el("small", {
        // Filled by applyIdentity() from the webpage record.
        class: "footer__colophon",
        "data-colophon": "",
      }),
      el("div", { class: "footer__colophon" }, [
        el("a", {
          "data-repo-link": "",
          hidden: true,
          target: "_blank",
          rel: "noopener",
          class: "nav__link--external",
          "data-i18n": "footer.source",
          text: t("footer.source"),
        }),
        el("span", { "data-repo-sep": "", hidden: true, text: "·" }),
        el("span", { text: t("footer.updated", { date: updated }) }),
      ]),
    ]),
  ]);
}

/**
 * Mount nav and footer into the page shell and wire up theme + language.
 * Returns the active route so page scripts can branch on it.
 */
/**
 * Fill the parts of the chrome that are facts about the site's owner.
 *
 * The CV link, the copyright line and the source link used to be literals in
 * this file — a name, a city, a path to a committed PDF and a GitHub URL. They
 * are content, so they come from the `webpage` record now, and the elements
 * that carry them stay hidden until it arrives rather than showing a link that
 * goes nowhere. The CV is the exception: a copy ships with the site, so that
 * link is live from the first paint and is only upgraded here.
 *
 * Exported so a page can re-run it after a language change.
 */
export function applyIdentity(profile, mediaUrl) {
  if (!profile) return;

  // Set in both directions, not just when the record has a file. This runs a
  // second time on the revalidated copy, and a CV cleared in the admin UI has
  // to fall back then — leaving the previous href in place would keep pointing
  // at a file that has been deleted.
  const cv = profile.cv ? mediaUrl(profile.cv) : FALLBACK_CV;
  $$("[data-cv-link]").forEach((link) => {
    link.href = cv;
  });

  const colophon = $("[data-colophon]");
  if (colophon) {
    const year = new Date().getFullYear();
    colophon.textContent = [
      `© ${year}`,
      profile.name,
      profile.locality,
    ]
      .filter(Boolean)
      .join(" · ")
      // "© 2026 Francisco Ribeiro", not "© 2026 · Francisco Ribeiro".
      .replace(`© ${year} · `, `© ${year} `);
  }

  const repo = $("[data-repo-link]");
  const repoSep = $("[data-repo-sep]");
  if (repo && profile.repoUrl) {
    repo.href = profile.repoUrl;
    repo.hidden = false;
    if (repoSep) repoSep.hidden = false;
  }
}

export function initSite({ footer = true } = {}) {
  applyTheme(state.theme);
  document.documentElement.lang = state.lang;

  const route = currentRoute();
  const page = $(".page");
  if (page) {
    page.prepend(buildNav(route));
    if (footer) page.append(buildFooter());
  }

  translateDom();

  // The chrome needs the profile, and so does every page. `loadContent()`
  // dedupes callers in flight and serves from cache, so asking here costs no
  // extra request. Imported lazily to keep the chrome free of a hard
  // dependency on the data layer.
  import("./data.js")
    .then(({ loadContent, mediaUrl }) =>
      // The `onUpdate` callback matters here, it is not belt-and-braces. A
      // cached copy paints before the network answers, so a value that has
      // since changed — a CV removed in the admin UI, say — would otherwise
      // stay on screen for the life of the cache entry, pointing at a file
      // that no longer exists. Re-applying on the fresh copy self-corrects.
      loadContent((fresh) => applyIdentity(fresh.profile, mediaUrl)).then(
        (content) => applyIdentity(content.profile, mediaUrl)
      )
    )
    .catch((err) => console.warn("[site] identity unavailable:", err.message));

  // Rebuild chrome text on language change without re-mounting the page.
  document.addEventListener("langchange", () => {
    $$(".lang-switch__opt").forEach((btn) =>
      btn.setAttribute("aria-pressed", String(btn.dataset.lang === state.lang))
    );
  });

  return route;
}

/* --- 8-bit icons ---------------------------------------------------------- */

const PIXELS = {
  folder: [
    [1, 3, 6, 2],
    [1, 5, 14, 8],
  ],
  folderCut: [[2, 7, 12, 1]],
  file: [[3, 2, 10, 12]],
  fileCut: [
    [11, 2, 2, 2],
    [5, 5, 6, 1],
    [5, 7, 6, 1],
    [5, 9, 4, 1],
  ],
};

/** Pixel-art folder/file icon as inline SVG, coloured by CSS. */
export function pixelIcon(kind = "folder") {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("pixel-icon", `pixel-icon--${kind}`);

  const solid = kind === "folder" ? PIXELS.folder : PIXELS.file;
  const cut = kind === "folder" ? PIXELS.folderCut : PIXELS.fileCut;

  for (const [x, y, w, h] of solid) {
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", x);
    r.setAttribute("y", y);
    r.setAttribute("width", w);
    r.setAttribute("height", h);
    r.setAttribute("fill", "currentColor");
    svg.append(r);
  }
  // "Cut" pixels punch back to the card colour, giving the seam / fold / lines.
  for (const [x, y, w, h] of cut) {
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", x);
    r.setAttribute("y", y);
    r.setAttribute("width", w);
    r.setAttribute("height", h);
    r.setAttribute("fill", "var(--surface)");
    svg.append(r);
  }
  return svg;
}
