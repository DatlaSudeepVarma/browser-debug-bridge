import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const host = "127.0.0.1";
const port = 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function serveFile(res, relativePath) {
  const safe = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(rootDir, safe === "" || safe === "." ? "index.html" : safe);
  if (!filePath.startsWith(rootDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    send(res, 404, "Not found");
    return;
  }
  const type = MIME[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${String(port)}`);
  if (url.pathname === "/api/debug/ok") {
    send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/debug/not-found") {
    send(res, 404, JSON.stringify({ error: "not found" }), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/debug/server-error") {
    send(res, 500, JSON.stringify({ error: "server error" }), "application/json; charset=utf-8");
    return;
  }
  serveFile(res, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
});

server.listen(port, host, () => {
  process.stdout.write(`Fixture server http://${host}:${String(port)}/\n`);
});
