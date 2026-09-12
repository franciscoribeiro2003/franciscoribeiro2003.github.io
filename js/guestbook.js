/**
 * The guestbook: a notebook that hinges open over the page.
 *
 * Each visitor gets **one page**, not a form. They draw on it with a pen and
 * drop handwritten text boxes anywhere they like, and the whole page is
 * flattened to a transparent PNG and sent to PocketBase. Reading the book is
 * then just turning pages of images over the notebook's own paper.
 *
 * The writable page is always the one after the last signed page, so it lands
 * on the left or the right depending on how many pages are already in the
 * book — the same way a real notebook fills up. The editing tools only appear
 * once you have turned to it.
 *
 * The model lives in `core/sketch.js`; this file is the notebook around it.
 */

import { el, t } from "./core/site.js";
import { listGuestbook, signGuestbook, mediaUrl } from "./core/data.js";
import {
  emptyPage, isEmptyPage, newBox, clamp01, pointFromEvent,
  renderPage, wrapText, exportPng, pageAltText, HAND_FONT,
} from "./core/sketch.js";

/** Text size as a fraction of page height — must match `sketch.js`. */
const TEXT_SIZE = 26 / 560;
const TEXT_LINE = 1.26;
const MIN_POINT_GAP = 0.0022; // in page units: ~1px on a 420px-wide page

export function mountGuestbook({ overlay, trigger }) {
  if (!overlay || !trigger) return;

  /* --- state -------------------------------------------------------------- */

  let entries = [];
  let loaded = false;
  let spread = 0;
  let lastFocused = null;
  let tool = "pen";
  let editingBoxId = null;
  let submitted = false;

  const draft = emptyPage();
  let name = "";

  /* --- keeping the draft ---------------------------------------------------
   *
   * A page in progress lives only in this closure, so a reload — or a stray
   * tap on the browser's back button — used to take the drawing with it. The
   * model is a small plain object, so it costs almost nothing to keep a copy
   * in localStorage and put it back on the next visit.
   *
   * Cleared on a successful submit and when the visitor discards the page.
   * Never cleared by simply closing the notebook: closing it is not the same
   * as throwing the drawing away.
   */
  const DRAFT_KEY = "fr:gb:draft:v1";
  let saveTimer = null;

  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (isEmptyPage(draft) && !name.trim()) {
          localStorage.removeItem(DRAFT_KEY);
          return;
        }
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ at: Date.now(), name, strokes: draft.strokes, boxes: draft.boxes })
        );
      } catch {
        /* quota or private mode — the draft just will not survive a reload */
      }
    }, 400);
  }

  function clearDraft() {
    clearTimeout(saveTimer);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  function restoreDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      // A month is long enough to come back to a drawing and short enough that
      // a forgotten one does not surprise someone a year later.
      if (!saved || Date.now() - (saved.at || 0) > 30 * 24 * 60 * 60 * 1000) {
        clearDraft();
        return;
      }
      if (Array.isArray(saved.strokes)) draft.strokes.push(...saved.strokes);
      if (Array.isArray(saved.boxes)) draft.boxes.push(...saved.boxes);
      if (typeof saved.name === "string") {
        name = saved.name;
        nameInput.value = saved.name;
      }
    } catch {
      clearDraft();
    }
  }

  /** The page a visitor writes on: the one after the last signed page. */
  const writeIndex = () => entries.length;
  const writeSpread = () => Math.floor(writeIndex() / 2);
  const onWriteSpread = () => spread === writeSpread() && !submitted;

  /* --- chrome ------------------------------------------------------------- */

  const book = el("div", { class: "gb__book" });
  const spine = el("div", { class: "gb__spine", "aria-hidden": "true" });
  const status = el("p", { class: "gb__status", role: "status" });

  const closeBtn = el("button", {
    class: "gb__close", type: "button", text: "✕",
    "aria-label": t("guestbook.close"), onclick: close,
  });

  const navBtn = (cls, label, onclick, text) =>
    el("button", { class: `gb__nav ${cls}`, type: "button", "aria-label": label, text, onclick });

  const prevBtn = navBtn("gb__nav--prev", t("guestbook.prev"), () => turn(-1), "←");
  const nextBtn = navBtn("gb__nav--next", t("guestbook.next"), () => turn(1), "→");
  const lastBtn = navBtn("gb__nav--last", t("guestbook.lastPage"), goToWritePage, "⇥");

  const bar = el("div", { class: "gb__bar" }, [prevBtn, lastBtn, nextBtn]);

  /* --- tools -------------------------------------------------------------- */

  const toolBtn = (id, label, glyph) =>
    el("button", {
      class: "gb__tool", type: "button", "data-tool": id,
      "aria-label": label, title: label, text: glyph,
      onclick: () => {
        // Commit first: picking up the pen while a box is open would otherwise
        // leave the textarea live over a page that is no longer listening to it.
        commitEditing();
        tool = id;
        paint();
      },
    });

  const penBtn = toolBtn("pen", t("guestbook.toolPen"), "✎");
  const textBtn = toolBtn("text", t("guestbook.toolText"), "T");

  const undoBtn = el("button", {
    class: "gb__tool", type: "button",
    "aria-label": t("guestbook.undo"), title: t("guestbook.undo"), text: "↶",
    onclick: () => {
      if (draft.strokes.length) draft.strokes.pop();
      redraw();
      syncTools();
    },
  });

  const discardBtn = el("button", {
    class: "gb__tool gb__tool--warn", type: "button",
    "aria-label": t("guestbook.discard"), title: t("guestbook.discard"), text: "⌫",
    onclick: () => {
      if (isEmptyPage(draft)) return;
      draft.strokes.length = 0;
      draft.boxes.length = 0;
      editingBoxId = null;
      status.textContent = "";
      clearDraft();
      paint();
    },
  });

  const nameInput = el("input", {
    class: "gb__name", type: "text", maxlength: "60",
    placeholder: t("guestbook.namePlaceholder"),
    "aria-label": t("guestbook.sign"),
  });
  nameInput.addEventListener("input", () => {
    name = nameInput.value;
    syncTools();
  });

  const submitBtn = el("button", {
    class: "gb__submit", type: "button",
    text: t("guestbook.submit"),
    onclick: submit,
  });

  const tools = el("div", { class: "gb__tools", hidden: true }, [
    el("div", { class: "gb__toolrow" }, [penBtn, textBtn, undoBtn, discardBtn]),
    el("div", { class: "gb__signrow" }, [nameInput, submitBtn]),
  ]);

  // Outside `tools` on purpose: submitting hides the tools, and the
  // confirmation message would have vanished with them.
  overlay.append(closeBtn, book, bar, tools, status);
  book.append(spine);

  function syncTools() {
    tools.hidden = !onWriteSpread();
    boxLayer.dataset.tool = tool;
    for (const btn of [penBtn, textBtn]) {
      btn.setAttribute("aria-pressed", String(btn.dataset.tool === tool));
    }
    undoBtn.disabled = !draft.strokes.length;
    discardBtn.disabled = isEmptyPage(draft);
    submitBtn.disabled = isEmptyPage(draft) || submitted;
    prevBtn.disabled = spread === 0;
    nextBtn.disabled = spread >= writeSpread();
    lastBtn.disabled = spread === writeSpread();
    // Every mutation path ends here, so this is the one place the draft needs
    // to be written from. The write itself is debounced.
    if (!submitted) saveDraft();
  }

  /* --- pages -------------------------------------------------------------- */

  function readPageNode(entry, number) {
    const page = el("div", { class: "gb__page" });
    if (!entry) {
      page.classList.add("gb__page--blank");
      return page;
    }
    page.append(
      el("img", {
        class: "gb__scan",
        src: mediaUrl(entry.image),
        alt: entry.alt || t("guestbook.aDrawing"),
        loading: "lazy",
        decoding: "async",
      }),
      el("p", { class: "gb__folio" }, [
        entry.name && el("span", { class: "gb__signed", text: `— ${entry.name}` }),
        el("span", { class: "gb__pageno", text: String(number) }),
      ].filter(Boolean))
    );
    return page;
  }

  /* --- the editable page -------------------------------------------------- */

  const canvas = el("canvas", { class: "gb__ink" });
  const boxLayer = el("div", { class: "gb__boxes" });
  const surface = el("div", { class: "gb__page gb__page--mine" }, [canvas, boxLayer]);

  let ctx = canvas.getContext("2d");
  let cssW = 0;
  let cssH = 0;

  /**
   * Size the backing store to the element's layout box, at device resolution.
   *
   * `clientWidth/clientHeight`, not `getBoundingClientRect()`. The notebook
   * animates open with a 3D `rotateX`, and a rect measured during that is the
   * foreshortened *projection* of the page, not its layout size. Sizing from
   * it once — which is exactly when the ResizeObserver first fires — left the
   * canvas at the wrong aspect for good, because the layout box never changes
   * afterwards and so the observer never fires again. Strokes then rendered
   * stretched and landed away from the pointer.
   */
  function sizeCanvas() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = width;
    cssH = height;
    // The textarea has to be set in the same size the canvas paints, or typing
    // would reflow the moment the box was committed to the render.
    surface.style.setProperty("--gb-text", `${TEXT_SIZE * cssH}px`);
    surface.style.setProperty("--gb-line", String(TEXT_LINE));
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctx = canvas.getContext("2d");
    }
    return true;
  }

  function redraw() {
    if (!sizeCanvas()) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Boxes being edited live in a textarea, so they must not also be painted.
    const visible = {
      strokes: draft.strokes,
      boxes: draft.boxes.filter((b) => b.id !== editingBoxId),
    };
    renderPage(ctx, visible, canvas.width, canvas.height);
    layoutBoxHits();
  }

  // The page is sized by CSS aspect-ratio, so its box is only known after
  // layout — the previous version measured it too early, got zero, and left
  // the canvas at its default 300×150 while CSS stretched it. That is what
  // made strokes land far from the cursor and look faceted.
  const observer = new ResizeObserver(() => redraw());
  observer.observe(canvas);

  /* --- drawing ------------------------------------------------------------ */

  let active = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (!onWriteSpread()) return;

    if (tool === "text") {
      const p = pointFromEvent(e, canvas);
      if (!p) return;
      // Essential, not tidiness. Without it the browser runs its default
      // mousedown focus behaviour after this handler, moving focus to <body>.
      // That blurs the textarea the new box just created, the blur handler
      // commits a box with no text in it, and an empty box is removed — so
      // the box appeared and vanished within the same click, and there was
      // nothing to type into.
      e.preventDefault();
      addBox(p.x, p.y);
      return;
    }

    const p = pointFromEvent(e, canvas);
    if (!p) return;
    e.preventDefault();
    commitEditing();
    // Capture keeps the stroke alive when the pointer leaves the page mid-line.
    // It throws if the pointer is no longer active, which is not worth losing
    // the stroke over.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* carry on uncaptured */
    }
    active = { pts: [p] };
    draft.strokes.push(active);
    redraw();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!active) return;
    e.preventDefault();

    // Coalesced events are the samples the browser collected between frames.
    // Without them a fast stroke is built from one point per frame, which is
    // exactly the sparse, faceted line that reads as "not smooth".
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const sample of events.length ? events : [e]) {
      const p = pointFromEvent(sample, canvas);
      if (!p) continue;
      const last = active.pts[active.pts.length - 1];
      // Drop samples that land on top of the previous one: they add nothing
      // to the curve and inflate the stored page.
      if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_POINT_GAP) continue;
      active.pts.push(p);
    }
    redraw();
  });

  const endStroke = (e) => {
    if (!active) return;
    if (e?.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    // A stroke of one point is a dot, which is legitimate; an empty one is not.
    if (!active.pts.length) draft.strokes.pop();
    active = null;
    redraw();
    syncTools();
  };
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);

  /* --- text boxes --------------------------------------------------------- */

  /**
   * Put the caret in the open text box.
   *
   * Retried on a timer rather than fired once in a microtask: a microtask runs
   * before the browser has finished the focus handling for the click that
   * opened the box, so a single attempt can be undone a moment later. Timers
   * are used rather than requestAnimationFrame because rAF never fires in a
   * background tab, and this notebook has been caught by that before.
   */
  function focusEditor(attempts = 3) {
    const area = boxLayer.querySelector("textarea");
    if (!area) return;
    area.focus();
    // Caret at the end, so re-opening a box continues rather than overwrites.
    const end = area.value.length;
    try {
      area.setSelectionRange(end, end);
    } catch {
      /* not all engines allow this before layout */
    }
    if (attempts > 1 && document.activeElement !== area) {
      setTimeout(() => focusEditor(attempts - 1), 16);
    }
  }

  function addBox(x, y) {
    commitEditing();
    const box = newBox(clamp01(x), clamp01(y));
    box.w = Math.min(0.46, 1 - box.x - 0.04);
    draft.boxes.push(box);
    editingBoxId = box.id;
    paint();
    focusEditor();
  }

  /**
   * The rendered height of a box, in page units.
   *
   * Measured in the canvas's backing-store pixels, which is what `renderPage`
   * draws in, then divided back to 0..1. Doing it in CSS pixels would drift
   * from the render by the device pixel ratio.
   */
  function boxHeight(box) {
    if (!canvas.height) return TEXT_SIZE;
    const size = TEXT_SIZE * canvas.height;
    const probe = canvas.getContext("2d");
    probe.save();
    probe.font = `${size}px ${HAND_FONT}`;
    const lines = wrapText(probe, box.text || " ", box.w * canvas.width);
    probe.restore();
    return (Math.max(1, lines.length) * size * TEXT_LINE) / canvas.height;
  }

  /** Position the hit areas over what the canvas painted. */
  function layoutBoxHits() {
    for (const node of boxLayer.querySelectorAll("[data-box]")) {
      const box = draft.boxes.find((b) => b.id === node.dataset.box);
      if (!box) continue;
      node.style.left = `${box.x * 100}%`;
      node.style.top = `${box.y * 100}%`;
      node.style.width = `${box.w * 100}%`;
      if (!node.classList.contains("gb__box--editing")) {
        node.style.height = `${boxHeight(box) * 100}%`;
      }
    }
  }

  /**
   * Close the open text box.
   *
   * Deliberately touches no DOM. It used to read `boxLayer.querySelector(
   * "textarea")` and assign that value to whichever box `editingBoxId` named —
   * two lookups that are only the same element while nothing is repainting.
   * Placing a second box repaints first, so the outgoing box's textarea was
   * still attached while `editingBoxId` already pointed at the new box, and
   * the new box inherited the old one's text. That is the "it clones what I
   * typed" bug.
   *
   * The `input` handler already writes `box.text` on every keystroke, so the
   * model is current and there is nothing to read back.
   */
  function commitEditing() {
    if (!editingBoxId) return;
    const box = draft.boxes.find((b) => b.id === editingBoxId);
    editingBoxId = null;
    // An untouched box would otherwise linger as an invisible hit area.
    if (box && !box.text.trim()) {
      draft.boxes = draft.boxes.filter((b) => b.id !== box.id);
    }
  }

  function boxNode(box) {
    const editing = box.id === editingBoxId;
    const node = el("div", {
      class: `gb__box${editing ? " gb__box--editing" : ""}`,
      "data-box": box.id,
    });

    if (editing) {
      const area = el("textarea", {
        class: "gb__boxinput",
        rows: "1",
        spellcheck: "false",
        "aria-label": t("guestbook.toolText"),
      });
      area.value = box.text;
      const grow = () => {
        area.style.height = "auto";
        area.style.height = `${area.scrollHeight}px`;
      };
      area.addEventListener("input", () => {
        box.text = area.value;
        grow();
        syncTools();
      });
      area.addEventListener("blur", () => {
        // Removing a focused node fires blur, so this also runs when a repaint
        // tears this textarea down. By then another box may already be the
        // editor — acting here would close it and repaint from inside a
        // repaint, which duplicated the page nodes.
        if (editingBoxId !== box.id) return;
        commitEditing();
        paint();
      });
      area.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          area.blur();
        }
      });
      node.append(area);
      queueMicrotask(grow);
    } else {
      // Transparent over the canvas-painted text: what you see is the render,
      // so there is no second implementation of the type to drift from it.
      node.addEventListener("pointerdown", (e) => {
        if (e.target.closest("[data-drag], [data-del]")) return;
        e.stopPropagation();
        // Same reason as placing a box: the default focus shift would blur the
        // textarea this is about to open.
        e.preventDefault();
        commitEditing();
        editingBoxId = box.id;
        paint();
        focusEditor();
      });
    }

    const drag = el("button", {
      class: "gb__boxgrip", type: "button", "data-drag": "",
      "aria-label": t("guestbook.move"), text: "⠿",
    });
    const del = el("button", {
      class: "gb__boxdel", type: "button", "data-del": "",
      "aria-label": t("guestbook.remove"), text: "✕",
      onclick: (e) => {
        e.stopPropagation();
        draft.boxes = draft.boxes.filter((b) => b.id !== box.id);
        if (editingBoxId === box.id) editingBoxId = null;
        paint();
      },
    });

    let from = null;
    drag.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Record the grab before capturing: `setPointerCapture` throws if the
      // pointer is not active, and losing the drag to that would be silent.
      const p = pointFromEvent(e, canvas);
      from = p ? { px: p.x, py: p.y, bx: box.x, by: box.y } : null;
      try {
        drag.setPointerCapture(e.pointerId);
      } catch {
        /* drag still works, it just ends if the pointer leaves the grip */
      }
    });
    drag.addEventListener("pointermove", (e) => {
      if (!from) return;
      const p = pointFromEvent(e, canvas);
      if (!p) return;
      const h = boxHeight(box);
      // Kept inside its own page: a box that wandered past the edge would be
      // cropped out of the exported PNG with no way to tell why.
      box.x = Math.min(Math.max(0, from.bx + (p.x - from.px)), 1 - box.w);
      box.y = Math.min(Math.max(0, from.by + (p.y - from.py)), 1 - h);
      layoutBoxHits();
      redraw();
    });
    const dropBox = () => (from = null);
    drag.addEventListener("pointerup", dropBox);
    drag.addEventListener("pointercancel", dropBox);

    node.append(drag, del);
    return node;
  }

  function paintBoxes() {
    boxLayer.replaceChildren(...draft.boxes.map(boxNode));
    layoutBoxHits();
  }

  /* --- painting ----------------------------------------------------------- */

  let painting = false;

  function paint() {
    // Rebuilding the pages fires blur/focus events on the nodes being removed,
    // and a handler that repaints in response would interleave two runs and
    // leave the book with duplicated pages.
    if (painting) return;
    painting = true;
    try {
      repaint();
    } finally {
      painting = false;
    }
  }

  function repaint() {
    [...book.querySelectorAll(".gb__page")].forEach((p) => p.remove());

    const write = writeIndex();
    const first = spread * 2;
    const sides = [first, first + 1].map((i) => {
      if (i < write) return readPageNode(entries[i], i + 1);
      if (i === write && !submitted) return surface;
      return readPageNode(null, i + 1);
    });

    book.append(...sides, spine);
    if (onWriteSpread()) {
      paintBoxes();
      redraw();
    }
    syncTools();
  }

  function turn(delta) {
    const next = spread + delta;
    if (next < 0 || next > writeSpread()) return;
    commitEditing();
    spread = next;
    paint();
  }

  function goToWritePage() {
    commitEditing();
    spread = writeSpread();
    paint();
  }

  /* --- submit ------------------------------------------------------------- */

  async function submit() {
    commitEditing();
    if (isEmptyPage(draft)) return;

    submitBtn.disabled = true;
    status.textContent = t("guestbook.sending");
    status.classList.remove("gb__status--bad");

    try {
      const { blob } = await exportPng(draft);
      await signGuestbook({
        name: name.trim(),
        altText: pageAltText(draft),
        blob,
      });
      submitted = true;
      clearDraft();
      draft.strokes.length = 0;
      draft.boxes.length = 0;
      status.textContent = t("guestbook.pending");
      paint();
    } catch (err) {
      console.warn("[guestbook] submit failed:", err.message);
      status.classList.add("gb__status--bad");
      status.textContent =
        err.message === "no-backend" ? t("guestbook.readonly") : t("guestbook.failed");
      submitBtn.disabled = false;
    }
  }

  /* --- open / close ------------------------------------------------------- */

  async function open() {
    lastFocused = document.activeElement;
    overlay.hidden = false;
    // Flush layout so the transition runs from the closed state. A synchronous
    // reflow rather than requestAnimationFrame, which never fires in a
    // background tab — the book would then stay invisible but interactive.
    void overlay.offsetHeight;
    overlay.setAttribute("data-open", "");

    if (!loaded) {
      loaded = true;
      restoreDraft();
      entries = await listGuestbook();
      spread = writeSpread();
    }
    paint();
    closeBtn.focus();
    document.addEventListener("keydown", onKey);
  }

  function close() {
    commitEditing();
    overlay.removeAttribute("data-open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => {
      overlay.hidden = true;
      lastFocused?.focus();
    }, 220);
  }

  function onKey(e) {
    if (e.key === "Escape") return close();
    if (e.target.matches("input, textarea")) return;
    if (e.key === "ArrowRight") turn(1);
    if (e.key === "ArrowLeft") turn(-1);
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  trigger.addEventListener("click", open);
  document.addEventListener("langchange", () => {
    nameInput.placeholder = t("guestbook.namePlaceholder");
    submitBtn.textContent = t("guestbook.submit");
    if (overlay.hidden) return;
    // Commit before repainting, as every other caller does. Repainting with a
    // box still open tears down its textarea, and the blur that follows would
    // try to repaint from inside this one.
    commitEditing();
    paint();
  });
}
