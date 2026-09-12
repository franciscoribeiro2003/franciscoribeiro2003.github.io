import { initSite, el, $, t, state, pixelIcon, translateDom } from "../core/site.js";
import { loadContent, mediaUrl } from "../core/data.js";

/**
 * The projects index.
 *
 * Projects are `posts` with `type: "project"` — the same model as the blog,
 * differing only in that field. So this page is a filtered list, and each
 * entry has a real page of its own at /projects/<slug>/ where the markdown
 * body is rendered.
 *
 * The file-explorer layout from the design survives: the sidebar is still a
 * tree, but its rows are now links rather than buttons that swapped a pane.
 * That is what makes per-project SEO possible — a crawler is handed one file
 * per URL, so a project can only have its own title and description if it has
 * its own address.
 */

initSite();

let projects = [];

function localized(obj, field) {
  return obj[`${field}_${state.lang}`] || obj[`${field}_en`] || obj[`${field}_pt`] || "";
}

/* --- sidebar tree --------------------------------------------------------- */

function renderTree() {
  const host = $("#project-tree");

  const rows = [
    el("div", { class: "tree__row" }, [
      el("span", { class: "tree__prefix", text: "" }),
      pixelIcon("folder"),
      el("span", { class: "tree__label", text: "projects/" }),
    ]),
  ];

  projects.forEach((project, i) => {
    const last = i === projects.length - 1;
    rows.push(
      el("a", { class: "tree__row tree__row--interactive", href: project.href }, [
        el("span", { class: "tree__prefix", text: last ? "└──" : "├──" }),
        pixelIcon("folder"),
        el("span", { class: "tree__label", text: `${project.slug}/` }),
      ])
    );
  });

  host.replaceChildren(...rows);
}

/* --- the index ------------------------------------------------------------ */

function card(project) {
  const title = localized(project, "title");
  const description = localized(project, "description");

  const text = el("div", { class: "entry-card__body" }, [
    el("h2", { class: "t-h2 entry-card__title", text: title }),
    description && el("p", { class: "t-body secondary", text: description }),
    project.tags?.length &&
      el(
        "div",
        { class: "tags" },
        project.tags.map((tag) => el("span", { class: "tag", text: tag }))
      ),
  ]);

  return el("article", { class: "entry-card" }, [
    project.coverThumb &&
      el("a", { class: "entry-card__cover", href: project.href, tabindex: "-1", "aria-hidden": "true" }, [
        el("img", {
          src: mediaUrl(project.coverThumb),
          alt: "",
          loading: "lazy",
          decoding: "async",
        }),
      ]),
    el("a", { class: "entry-card__hit", href: project.href }, [text]),
  ]);
}

function renderIndex() {
  const host = $("#project-detail");
  if (!projects.length) {
    host.replaceChildren(el("p", { class: "notice", text: t("projects.empty") }));
    return;
  }
  host.replaceChildren(
    el("p", { class: "crumb", text: "projects /" }),
    el("div", { class: "entry-cards" }, projects.map(card))
  );
}

/* --- boot ----------------------------------------------------------------- */

function render() {
  renderTree();
  renderIndex();
  translateDom();
}

async function boot() {
  const content = await loadContent((fresh) => {
    projects = fresh.projects || [];
    render();
  });
  projects = content.projects || [];
  render();
}

boot();
document.addEventListener("langchange", render);
