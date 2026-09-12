import {
  initSite,
  el,
  $,
  t,
  state,
  pixelIcon,
  translateDom,
} from "../core/site.js";
import { loadContent, loadTrips, mediaUrl } from "../core/data.js";
import { mountGuestbook } from "../guestbook.js";

initSite();

/* --- file tree ------------------------------------------------------------ */

function treeRow({ prefix, kind, label, nested }) {
  return el(
    "div",
    { class: `tree__row${nested ? " tree__row--nested" : ""}` },
    [
      el("span", { class: "tree__prefix", text: prefix }),
      pixelIcon(kind),
      el("span", { class: "tree__label", text: label }),
    ]
  );
}

function renderTree(projects) {
  const host = $("#home-tree");
  if (!host) return;
  host.replaceChildren();

  // One folder per project, nothing else. An earlier version expanded the
  // first one with a fake `.md` leaf to make the tree look deeper; it just
  // read as a project that had a file the others did not.
  const shown = projects.slice(0, 4);
  const rows = [{ prefix: "", kind: "folder", label: "projects/" }];

  shown.forEach((project, i) => {
    rows.push({
      prefix: i === shown.length - 1 ? "└──" : "├──",
      kind: "folder",
      label: `${project.slug}/`,
    });
  });

  rows.forEach((r) => host.append(treeRow(r)));
}

/* --- slideshow ------------------------------------------------------------ */

function renderSlideshow(projects) {
  const frame = $("#home-slideshow .slideshow__frame");
  const dots = $("#slideshow-dots");
  const caption = $("#slideshow-caption");
  if (!frame || !dots) return;

  // The original file, not a thumb.
  const slides = projects
    .filter((p) => p.coverFull)
    .slice(0, 5)
    .map((p) => ({ src: mediaUrl(p.coverFull), label: p.slug }));

  if (!slides.length) return; // keep the placeholder caption

  dots.replaceChildren();
  // A single dot is not a control, it is a smudge. Only show them when there
  // is actually something to page between.
  dots.hidden = slides.length < 2;
  const imgs = slides.map((s, i) => {
    const img = el("img", {
      class: "slideshow__slide",
      src: s.src,
      alt: "",
      loading: "lazy",
      decoding: "async",
    });
    if (i === 0) img.dataset.active = "";
    frame.prepend(img);
    const dot = el("span", { class: "slideshow__dot" });
    if (i === 0) dot.dataset.active = "";
    dots.append(dot);
    return img;
  });

  caption.textContent = slides[0].label;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || slides.length < 2) return;

  let i = 0;
  setInterval(() => {
    imgs[i].removeAttribute("data-active");
    dots.children[i].removeAttribute("data-active");
    i = (i + 1) % imgs.length;
    imgs[i].dataset.active = "";
    dots.children[i].dataset.active = "";
    caption.textContent = slides[i].label;
  }, 4200);
}

/* --- globe preview -------------------------------------------------------- */

/**
 * The map tile shows a real 3D model (a <model-viewer> element already in the
 * markup — see index.html), not the MapLibre globe from the map page itself.
 * This just wires up the trip count and respects reduced motion, since
 * `auto-rotate` is model-viewer's own render loop and the site's CSS-level
 * `prefers-reduced-motion` rule (base.css) cannot reach into it.
 */
function renderGlobePreview(tripCount) {
  const host = $("#globe-preview");
  if (!host) return;
  host.setAttribute(
    "alt",
    `A rotating 3D model of Earth, standing in for the ${tripCount} routes mapped in detail on the map page.`
  );
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    host.removeAttribute("auto-rotate");
  }
}

/* --- experience / education / contact ------------------------------------- */

function fmtRange(start, end) {
  const opts = { year: "numeric", month: "short" };
  const locale = state.lang === "pt" ? "pt-PT" : "en-GB";
  const s = start ? new Date(start).toLocaleDateString(locale, opts) : "";
  const e = end
    ? new Date(end).toLocaleDateString(locale, opts)
    : state.lang === "pt" ? "Atual" : "Present";
  return `${s} —\n${e}`;
}

function renderExperience(items) {
  const host = $("#home-experience");
  if (!host) return;
  host.replaceChildren();

  items.forEach((job) => {
    host.append(
      el("article", { class: "timeline__entry" }, [
        el("p", { class: "timeline__date", text: fmtRange(job.start, job.end) }),
        el("div", { class: "timeline__body" }, [
          el("h3", { class: "t-h3", text: pick(job, "role") }),
          el("p", { class: "timeline__meta" }, [
            el("span", { text: job.company }),
            // Prefer the CV note ("Full-time since Feb 2026, part-time before")
            // over the bare location, and keep this identical to what
            // tools/prerender.mjs bakes in — crawler and reader see one text.
            (pick(job, "note") || job.location) &&
              el("span", { class: "sep", text: "·" }),
            (pick(job, "note") || job.location) &&
              el("span", { class: "place", text: pick(job, "note") || job.location }),
          ]),
          el("p", { class: "t-body secondary", text: pick(job, "summary") }),
          el(
            "div",
            { class: "tags" },
            (job.tags || []).map((tag) => el("span", { class: "tag", text: tag }))
          ),
        ]),
      ])
    );
  });
}

function renderEducation(items) {
  const host = $("#home-education");
  if (!host) return;
  host.replaceChildren();

  items.forEach((d) => {
    host.append(
      el("article", { class: "degrees__entry" }, [
        el("p", { class: "t-mono-xs muted", text: d.years }),
        el("h3", { class: "t-h3", text: pick(d, "degree") }),
        el("p", { class: "t-body-s secondary", text: pick(d, "school") }),
        el(
          "div",
          { class: "tags" },
          (d.areas || []).map((a) => el("span", { class: "tag", text: a }))
        ),
      ])
    );
  });
}

function renderContact(links) {
  const host = $("#home-contact");
  if (!host) return;
  host.replaceChildren();
  links.forEach((l) => {
    host.append(
      el("a", { href: l.href, target: l.external ? "_blank" : null, rel: l.external ? "noopener" : null }, [
        el("span", { class: "glyph", "aria-hidden": "true", text: l.glyph }),
        el("span", { class: "label", text: l.label }),
      ])
    );
  });
}

/** Pick a localised field (`role_en` / `role_pt`) with an unsuffixed fallback. */
function pick(obj, field) {
  return obj[`${field}_${state.lang}`] ?? obj[`${field}_en`] ?? obj[field] ?? "";
}

/* --- boot ----------------------------------------------------------------- */

async function render() {
  const [content, trips] = await Promise.all([loadContent(), loadTrips()]);

  const profile = content.profile || {};

  if (profile.portrait) {
    const img = el("img", {
      class: "profile__portrait",
      id: "profile-portrait",
      src: mediaUrl(profile.portrait),
      alt: profile.name,
      width: "200",
      height: "248",
    });
    $("#profile-portrait").replaceWith(img);
  }

  if (profile.name) $("#profile-name").textContent = profile.name;

  // The short line under the name: job title and city, both from the record.
  // It used to be a fixed i18n string ("Software engineer · Porto, Portugal"),
  // which meant a job change needed a commit — and it overwrote the tagline
  // the page had just set, so whichever ran last won.
  const role = [pick(profile, "jobTitle"), profile.locality].filter(Boolean).join(" · ");
  if (role) $("#profile-role").textContent = role;

  const bio = pick(profile, "bio");
  if (bio) $("#profile-bio").textContent = bio;
  const interests = pick(profile, "interests");
  if (interests) $("#profile-interests").textContent = interests;

  const projects = content.projects || [];
  $("#project-count").textContent = projects.length || "—";

  renderTree(projects);
  renderSlideshow(projects);
  renderGlobePreview(trips.length);
  renderExperience(content.experience || []);
  renderEducation(content.education || []);
  renderContact(content.contact || []);
  translateDom();
}

render();
document.addEventListener("langchange", render);

mountGuestbook({
  overlay: $("#guestbook"),
  trigger: $("#guestbook-open"),
});

/* --- map tile: info tooltip + click-anywhere navigation -------------------
 *
 * #map-tile is a <div role="link">, not an <a> — the info button below is
 * interactive content, which an <a> may not contain. So both the tile's own
 * "click navigates to /map/" behaviour and the info button's "don't
 * navigate, toggle the credit instead" behaviour are wired here by hand.
 * Runs once at boot, not inside render(): it wires listeners, it doesn't
 * depend on the fetched content.
 */
function initMapTile() {
  const tile = $("#map-tile");
  const infoWrap = tile?.querySelector(".tile__info-wrap");
  const infoBtn = $("#model-info-btn");
  if (!tile || !infoWrap || !infoBtn) return;

  const closeInfo = () => infoWrap.classList.remove("is-open");

  // Tap-to-toggle, for touch screens where :hover never fires. stopPropagation
  // is what stops this click from also bubbling up to the tile's own handler
  // below and navigating away.
  infoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    infoWrap.classList.toggle("is-open");
  });
  document.addEventListener("click", (e) => {
    if (!infoWrap.contains(e.target)) closeInfo();
  });
  infoWrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeInfo();
      infoBtn.blur();
    }
  });

  tile.addEventListener("click", () => {
    window.location.href = "/map/";
  });
  tile.addEventListener("keydown", (e) => {
    if (e.key === "Enter") window.location.href = "/map/";
  });
}

initMapTile();
