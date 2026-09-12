/**
 * The guestbook page: a vector model of one hand-written page, and the code
 * that draws it, edits it, and exports it as a transparent PNG.
 *
 * Everything is stored as **normalised coordinates**, 0..1 across the page, not
 * pixels. That one decision solves several problems at once:
 *
 *   The canvas can be any size. Resizing the window, opening on a phone, or a
 *   different device pixel ratio all just re-render the same model — the
 *   previous version painted straight onto the bitmap, so a resize either
 *   stretched the drawing or lost it.
 *
 *   Export is not a screenshot. The PNG is rendered from the model at whatever
 *   resolution is asked for, so it is crisp regardless of how big the page was
 *   on screen.
 *
 *   Undo is free — remove the last stroke and redraw.
 *
 * The page is transparent. The paper the drawing sits on is the notebook's own
 * background, in both light and dark themes (`--paper` does not change), so the
 * exported PNG carries only the marks.
 */

/** The page's aspect, matching `.gb__page { aspect-ratio }` in the CSS. */
export const PAGE_W = 420;
export const PAGE_H = 560;
export const PAGE_RATIO = PAGE_H / PAGE_W;

/** Ink. Dark on paper — `--paper` stays light in both themes. */
export const INK = "#222945";

/** Stroke width as a fraction of page width, so it scales with the page. */
const STROKE_W = 2.6 / PAGE_W;

/** Handwriting size as a fraction of page height. */
const TEXT_SIZE = 26 / PAGE_H;
const TEXT_LINE = 1.26;
export const HAND_FONT = '"Caveat", "Segoe Script", cursive';

/* --- the model ------------------------------------------------------------ */

export const emptyPage = () => ({ strokes: [], boxes: [] });

export const isEmptyPage = (page) =>
  !page || (!page.strokes.length && !page.boxes.some((b) => b.text.trim()));

let boxSeq = 0;
export const newBox = (x, y) => ({
  id: `b${++boxSeq}`,
  x,
  y,
  w: 0.46,
  text: "",
});

/* --- geometry ------------------------------------------------------------- */

export const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Pointer position in page coordinates.
 *
 * Taken from the element's own box each time rather than a cached rect: the
 * notebook animates open with a 3D transform, and a rect captured while that
 * was still running would be wrong for the whole stroke.
 */
export function pointFromEvent(event, element) {
  const r = element.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  // Four decimals is a twenty-fifth of a pixel on a 420px page — far below
  // what anyone can draw — and it keeps the stored model and the saved draft
  // a third of the size that full float precision would.
  const round = (n) => Math.round(clamp01(n) * 1e4) / 1e4;
  return {
    x: round((event.clientX - r.left) / r.width),
    y: round((event.clientY - r.top) / r.height),
  };
}

/* --- drawing -------------------------------------------------------------- */

/**
 * Trace a stroke as a curve, not a polyline.
 *
 * A raw `lineTo` between samples makes a stroke look faceted, which is most of
 * what "not smooth" means when drawing with a mouse: pointer samples arrive
 * far apart when the cursor moves fast. Each sample becomes the control point
 * of a quadratic that runs between the midpoints of its neighbours, so the
 * curve passes smoothly through the gesture rather than cornering at every
 * sample.
 */
function tracePath(ctx, pts, w, h) {
  const at = (p) => [p.x * w, p.y * h];

  if (pts.length === 1) {
    // A tap is a dot, not nothing.
    const [x, y] = at(pts[0]);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y);
    return;
  }

  let [x0, y0] = at(pts[0]);
  ctx.moveTo(x0, y0);

  if (pts.length === 2) {
    const [x1, y1] = at(pts[1]);
    ctx.lineTo(x1, y1);
    return;
  }

  for (let i = 1; i < pts.length - 1; i++) {
    const [cx, cy] = at(pts[i]);
    const [nx, ny] = at(pts[i + 1]);
    ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  const [lx, ly] = at(pts[pts.length - 1]);
  ctx.lineTo(lx, ly);
}

export function drawStroke(ctx, stroke, w, h, colour = INK) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, STROKE_W * w);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  tracePath(ctx, stroke.pts, w, h);
  ctx.stroke();
  ctx.restore();
}

/* --- text ----------------------------------------------------------------- */

/** Break `text` into lines that fit `maxWidth`, honouring explicit newlines. */
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${line} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }
  return lines;
}

export function drawBox(ctx, box, w, h, colour = INK) {
  const text = String(box.text || "").trim();
  if (!text) return;

  const size = TEXT_SIZE * h;
  ctx.save();
  ctx.fillStyle = colour;
  ctx.font = `${size}px ${HAND_FONT}`;
  ctx.textBaseline = "top";

  const lines = wrapText(ctx, box.text, box.w * w);
  lines.forEach((line, i) => {
    ctx.fillText(line, box.x * w, box.y * h + i * size * TEXT_LINE);
  });
  ctx.restore();
}

/** Render a whole page onto a context sized `w` × `h`. Does not clear. */
export function renderPage(ctx, page, w, h, colour = INK) {
  for (const stroke of page.strokes) drawStroke(ctx, stroke, w, h, colour);
  for (const box of page.boxes) drawBox(ctx, box, w, h, colour);
}

/* --- export --------------------------------------------------------------- */

/**
 * Make sure the handwriting face is available to the canvas.
 *
 * `ctx.fillText` does not wait for a webfont: with Caveat still loading it
 * silently falls back to a system cursive, and the exported PNG then looks
 * nothing like what the visitor saw. Resolves either way so a font that never
 * arrives cannot block a submission.
 */
export async function ensureHandFont(sizePx = 32) {
  try {
    await document.fonts.load(`${sizePx}px ${HAND_FONT}`);
    await document.fonts.ready;
  } catch {
    /* no font loading API, or the face failed — the fallback will do */
  }
}

/**
 * The page as a transparent PNG.
 *
 * Every page is an object in Cloud Storage, paid for monthly and forever, so
 * the size is bounded. It is worth being honest about the scale of that cost,
 * because guessing at it leads to the wrong trade-off. Measured on this page
 * geometry at 840 × 1120:
 *
 *   a signature and a line of text     ~29 KB
 *   twenty strokes                    ~130 KB
 *   a densely scribbled page          ~330 KB
 *
 * At GCS standard pricing, a thousand pages averaging 300 KB costs well under
 * a cent a month. So `maxBytes` is a guard against a pathological upload, not
 * a budget to optimise against — an earlier 220 KB cap was downscaling ordinary
 * dense drawings to 55% and saving fractions of a cent for visible blur.
 *
 * Transparency is what makes these numbers small: a single ink colour over a
 * flat alpha channel is close to the best case PNG has.
 *
 * Anything still over the cap is re-rendered smaller rather than refused —
 * halving the dimensions quarters the pixels, so one step is normally enough,
 * and a slightly softer page beats losing the drawing.
 */
export async function exportPng(page, { width = 840, maxBytes = 400_000 } = {}) {
  await ensureHandFont();

  for (const scale of [1, 0.75, 0.55, 0.4]) {
    const w = Math.round(width * scale);
    const h = Math.round(w * PAGE_RATIO);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // No fill: the paper is the notebook's, not the image's.
    renderPage(ctx, page, w, h);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("canvas-export-failed");
    if (blob.size <= maxBytes || scale === 0.4) {
      return { blob, width: w, height: h, scale };
    }
  }
  throw new Error("canvas-export-failed");
}

/** Plain text of a page, for the image's alt attribute. */
export function pageAltText(page) {
  const text = (page.boxes || [])
    .map((b) => String(b.text || "").trim())
    .filter(Boolean)
    .join(" · ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 500);
}
