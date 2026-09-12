#!/usr/bin/env node
/**
 * Empty every generated block, so the repo holds no content.
 *
 * `tools/prerender.mjs` writes the `<head>` in place, which is right at deploy
 * time and wrong in git: it left ~30 KB of names, job titles, project
 * abstracts and trip statistics committed in the page files. That is content
 * in the frontend repo, and this project does not do that.
 *
 * So the committed HTML carries the markers and nothing between them. CI runs
 * the prerenderer on a fresh checkout before deploying, so the published site
 * has the full `<head>`; the repo never does.
 *
 * Run this after a local `npm run prerender` and before committing.
 *
 * It touches **tracked files only**. The generated per-post pages,
 * `sitemap.xml` and `robots.txt` are gitignored, so they cannot pollute a
 * commit and there is no reason to delete them — doing so by default left
 * /projects/<slug>/ returning 404 on the local dev server, which is a
 * confusing way to be told the tree is clean. `--generated` removes them when
 * that is actually what you want.
 *
 * Usage  node tools/seo-reset.mjs [--check] [--generated]
 *
 *   --check       report what is dirty and exit non-zero, changing nothing
 *   --generated   also delete the gitignored generated files
 */

import { readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHECK = process.argv.includes("--check");
const GENERATED = process.argv.includes("--generated");

const PAGES = [
  "index.html",
  "projects/index.html",
  "map/index.html",
  "photography/index.html",
  "blog/index.html",
];

/** Collapse `<!-- name:start --> … <!-- name:end -->` to an empty pair. */
function emptyBlock(html, name) {
  const open = `<!-- ${name}:start -->`;
  const close = `<!-- ${name}:end -->`;
  const start = html.indexOf(open);
  if (start === -1) return { html, changed: 0 };
  const end = html.indexOf(close, start);
  if (end === -1) return { html, changed: 0 };

  const inner = html.slice(start + open.length, end);
  // An emptied block still holds the newline and indent that keep the markers
  // on their own lines. Whitespace is not content, so it is already clean —
  // testing the raw length here made `--check` report every reset file as
  // dirty, and a check that always fails is a check nobody runs.
  if (!inner.trim()) return { html, changed: 0 };

  return {
    html: `${html.slice(0, start)}${open}\n  ${close}${html.slice(end + close.length)}`,
    changed: inner.trim().length,
  };
}

async function main() {
  let dirty = 0;
  const report = [];

  for (const page of PAGES) {
    const file = path.join(ROOT, page);
    let html;
    try {
      html = await readFile(file, "utf8");
    } catch {
      continue;
    }

    let changed = 0;
    for (const name of ["seo", "jsonld"]) {
      const result = emptyBlock(html, name);
      html = result.html;
      changed += result.changed;
    }

    if (changed) {
      dirty += changed;
      report.push({ page, changed });
      if (!CHECK) await writeFile(file, html);
    }
  }

  /* --- generated files (opt-in) -------------------------------------------- */
  // Gitignored, so they never reach a commit. Only listed/removed on request.

  const generated = [];
  if (!GENERATED) {
    reportAndExit(report, generated, dirty);
    return;
  }
  for (const dir of ["blog", "projects"]) {
    let entries = [];
    try {
      entries = await readdir(path.join(ROOT, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) generated.push(path.join(dir, entry.name));
    }
  }
  for (const file of ["sitemap.xml", "robots.txt"]) {
    try {
      await readFile(path.join(ROOT, file), "utf8");
      generated.push(file);
    } catch {
      /* not there */
    }
  }

  if (!CHECK) {
    for (const target of generated) {
      await rm(path.join(ROOT, target), { recursive: true, force: true });
    }
  }

  reportAndExit(report, generated, dirty);
}

function reportAndExit(report, generated, dirty) {
  for (const r of report) {
    console.log(`  ${CHECK ? "dirty" : "reset"}  ${r.page.padEnd(26)} ${r.changed} chars`);
  }
  for (const g of generated) {
    console.log(`  ${CHECK ? "extra" : "rm   "}  ${g}`);
  }

  if (!dirty && !generated.length) {
    console.log("clean — no generated content in the working tree");
    return;
  }

  if (CHECK) {
    if (!dirty) return; // only gitignored extras — nothing that can be committed
    console.error(
      `\n${dirty} chars of generated content in ${report.length} tracked page(s).\n` +
        `Run \`npm run seo:reset\` before committing.`
    );
    process.exit(1);
  }

  console.log(
    `\nreset ${dirty} chars across ${report.length} page(s)` +
      `${generated.length ? `, removed ${generated.length} generated path(s)` : ""}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
