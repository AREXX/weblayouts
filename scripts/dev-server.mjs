// Local dev/test server. NOT used in production — Vercel serves the static
// files and runs api/*.js itself. This mounts the same handlers over plain
// Node http + serves the repo's static files, using PGlite (in-process
// Postgres) so you can run the whole booking flow with zero services:
//
//   node scripts/dev-server.mjs        # http://localhost:3000
//
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
};

// cache imported handlers by route
const handlers = new Map();
async function getHandler(name) {
  if (!handlers.has(name)) {
    const mod = await import(pathToFileURL(join(ROOT, "api", name + ".js")).href);
    handlers.set(name, mod.default);
  }
  return handlers.get(name);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  // give handlers the query object Vercel would provide
  req.query = Object.fromEntries(url.searchParams.entries());

  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/\/$/, "");
    if (!/^[a-z0-9_-]+$/i.test(name)) { res.statusCode = 404; return res.end("Not found"); }
    let fn;
    try { fn = await getHandler(name); }
    catch { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, error: "No such endpoint" })); }
    return fn(req, res);
  }

  // static files
  let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  if (p === "/" || p === "\\") p = "/index.html";
  const file = join(ROOT, p);
  try {
    const st = await stat(file);
    if (st.isDirectory()) throw new Error("dir");
    const buf = await readFile(file);
    res.setHeader("Content-Type", MIME[extname(file).toLowerCase()] || "application/octet-stream");
    res.end(buf);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});

server.listen(PORT, () => console.log(`dev server → http://localhost:${PORT}  (PGlite in-memory DB)`));
