#!/usr/bin/env node
/**
 * The local dev server.
 *
 * `python3 -m http.server` was doing this job and had two problems that both
 * cost real debugging time:
 *
 *   It sends no cache headers, so the browser applies its own heuristic and
 *   caches ES modules. Edit `js/core/site.js`, reload, and the old module is
 *   still running — the page looks unchanged and the edit looks broken. Every
 *   response here is `no-store`.
 *
 *   It 404s with its own plain-text page. GitHub Pages serves `404.html` for
 *   any unknown path, which is what the site's own 404 page is for, so local
 *   and production disagreed exactly where you would want them to agree.
 *
 * Static files only, from the repo root. No build, no watch, no dependencies.
 *
 * Usage  node tools/dev-server.mjs [--port 4321]
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = Number(portArg === -1 ? 4321 : args[portArg + 1]) || 4321;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
};

const contentType = (file) => TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";

/** Resolve a URL path to a file inside ROOT, or null if it escapes or is missing. */
async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  // Normalise before joining: `/../` in a request must not reach outside ROOT.
  const target = path.resolve(ROOT, `.${path.posix.normalize(decoded)}`);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      const index = path.join(target, "index.html");
      await stat(index);
      return index;
    }
    return target;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const send = (status, type, body) => {
    res.writeHead(status, {
      "Content-Type": type,
      // The whole point: never let the browser reuse a module across an edit.
      "Cache-Control": "no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    if (body === undefined) res.end();
    else if (typeof body === "string") res.end(body);
    else body.pipe(res);
  };

  const file = await resolveFile(req.url || "/");

  if (!file) {
    // GitHub Pages behaviour: the site's own 404 page, with a 404 status.
    try {
      const notFound = await readFile(path.join(ROOT, "404.html"), "utf8");
      send(404, TYPES[".html"], notFound);
    } catch {
      send(404, TYPES[".txt"], `404 — no file for ${req.url}\n`);
    }
    console.log(`  404  ${req.url}`);
    return;
  }

  send(200, contentType(file), createReadStream(file));
});

server.listen(PORT, () => {
  console.log(`\n  site      http://localhost:${PORT}`);
  console.log(`  root      ${ROOT}`);
  console.log(`  caching   off — every response is no-store\n`);
});
