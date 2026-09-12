import { initSite, el, $, t, state, translateDom } from "../core/site.js";
import { loadContent } from "../core/data.js";

/**
 * The blog index.
 *
 * Blog entries are `posts` with `type: "blog"` — the same model as the
 * projects. Each has a page of its own at /blog/<slug>/ where the markdown
 * body is rendered.
 *
 * One exception to that: an entry with a `link` and no body was published
 * somewhere else, and its page would be a dead end that says so. Those link
 * straight out from the list instead.
 */

initSite();

let posts = [];
let topic = "all";

function localized(obj, field) {
  return obj[`${field}_${state.lang}`] || obj[`${field}_en`] || obj[`${field}_pt`] || "";
}

/** Where the list row points: the post's own page, or straight out. */
function destination(post) {
  const hasBody = Boolean(localized(post, "body").trim());
  return hasBody || !post.link
    ? { href: post.href, external: false }
    : { href: post.link, external: true };
}

function topics() {
  return ["all", ...new Set(posts.flatMap((p) => p.tags || []))];
}

function renderFilters() {
  $("#topic-filters").replaceChildren(
    ...topics().map((name) =>
      el("button", {
        class: "chip",
        type: "button",
        "aria-pressed": String(topic === name),
        text: name === "all" ? t("blog.all") : name,
        onclick: () => {
          topic = name;
          renderFilters();
          renderPosts();
        },
      })
    )
  );
}

function renderPosts() {
  const host = $("#post-list");
  const visible = posts.filter(
    (p) => topic === "all" || (p.tags || []).includes(topic)
  );

  if (!visible.length) {
    host.replaceChildren(el("p", { class: "notice", text: t("blog.empty") }));
    return;
  }

  host.replaceChildren(
    ...visible.map((post) => {
      const to = destination(post);

      const body = el("div", { class: "post__body" }, [
        el("h2", { class: "t-h2 post__title", text: localized(post, "title") }),
        el("p", { class: "t-body secondary", text: localized(post, "description") }),
        el(
          "p",
          { class: "post__tags" },
          (post.tags || []).map((tag) => el("span", { text: `#${tag.toLowerCase()}` }))
        ),
      ]);

      return el("article", { class: "post" }, [
        post.date && el("p", { class: "post__date", text: post.date }),
        el(
          "a",
          {
            class: "post__hit",
            href: to.href,
            ...(to.external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {}),
          },
          [body]
        ),
      ].filter(Boolean));
    })
  );
}

async function boot() {
  const content = await loadContent((fresh) => {
    posts = fresh.blog || [];
    render();
  });
  posts = content.blog || [];
  render();
}

function render() {
  renderFilters();
  renderPosts();
  translateDom();
}

boot();
document.addEventListener("langchange", render);
