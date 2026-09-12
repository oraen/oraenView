const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const port = Number(process.env.PORT || 4173);
const publicDirectory = path.join(__dirname, "public");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function safeFilePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(publicDirectory, relativePath);
  return resolved.startsWith(`${publicDirectory}${path.sep}`) || resolved === publicDirectory ? resolved : null;
}

const server = http.createServer((request, response) => {
  const filePath = safeFilePath(request.url);
  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    const isAssetRequest = Boolean(path.extname(filePath));
    if ((statError || !stats.isFile()) && isAssetRequest) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const requestedFile = !statError && stats.isFile() ? filePath : path.join(publicDirectory, "index.html");
    fs.readFile(requestedFile, (readError, content) => {
      if (readError) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Unable to load application");
        return;
      }
      const extension = path.extname(requestedFile).toLowerCase();
      response.writeHead(200, {
        "Content-Type": mimeTypes[extension] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(content);
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Oraen View is running at http://127.0.0.1:${port}`);
});
