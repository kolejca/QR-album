const fs = require("fs");
const http = require("http");
const path = require("path");

const root = __dirname;
const uploads = path.join(root, "uploads");
const manifestPath = path.join(uploads, "manifest.json");
const port = Number(process.env.PORT) || 4173;
const maxBytes = 12 * 1024 * 1024;
const ADMIN_PIN = process.env.QR_ALBUM_ADMIN_PIN || "";

const extensions = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

fs.mkdirSync(uploads, { recursive: true });

let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

function readManifest() {
  try {
    const photos = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return Array.isArray(photos) ? photos : [];
  } catch {
    return [];
  }
}

function writeManifest(photos) {
  fs.writeFileSync(manifestPath, JSON.stringify(photos));
}

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function guestFolder(firstName, lastName) {
  const slug = (sanitizeName(firstName) + " " + sanitizeName(lastName))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "guest";
}

function publicPhoto(photo) {
  return {
    id: photo.id,
    createdAt: photo.createdAt,
    url: "/uploads/" + photo.file.replace(/\\/g, "/"),
    firstName: photo.firstName || "",
    lastName: photo.lastName || "",
    guestFolder: photo.guestFolder || "",
  };
}

function isAdmin(req) {
  const pin = req.headers["x-admin-pin"];
  return Boolean(ADMIN_PIN && pin === ADMIN_PIN);
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("too large");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function resolveInsideRoot(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  const relative = pathname.replace(/^\/+/, "");
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) {
    return null;
  }
  return full;
}

function sendFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (filePath.startsWith(uploads + path.sep) && !Object.values(extensions).includes(extension)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": filePath.startsWith(uploads + path.sep) ? "public, max-age=31536000" : "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;

  try {
    if (req.method === "POST" && pathname === "/api/admin") {
      const body = await readBody(req);
      const payload = JSON.parse(body.toString("utf8"));
      const pin = String(payload.pin || "");
      if (ADMIN_PIN && pin === ADMIN_PIN) {
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 403, { error: "invalid pin" });
      return;
    }

    if (req.method === "GET" && pathname === "/api/photos") {
      const photos = readManifest()
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(publicPhoto);
      sendJson(res, 200, photos);
      return;
    }

    if (req.method === "POST" && pathname === "/api/photos") {
      const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const body = await readBody(req);
      let buffer = body;
      let extension = extensions[type];

      let firstName = "";
      let lastName = "";

      if (type === "application/json") {
        const payload = JSON.parse(body.toString("utf8"));
        firstName = sanitizeName(payload.firstName);
        lastName = sanitizeName(payload.lastName);
        if (!firstName || !lastName) {
          sendJson(res, 400, { error: "name required" });
          return;
        }
        const match = String(payload.image || "").match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
        if (!match) {
          sendJson(res, 400, { error: "bad image" });
          return;
        }
        buffer = Buffer.from(match[1], "base64");
        extension = ".jpg";
      }

      if (!extension || !buffer.length) {
        sendJson(res, 415, { error: "unsupported image" });
        return;
      }

      const photo = await enqueue(async () => {
        const id = createId();
        const folder = guestFolder(firstName, lastName);
        const file = folder + "/" + id + extension;
        await fs.promises.mkdir(path.join(uploads, folder), { recursive: true });
        await fs.promises.writeFile(path.join(uploads, file), buffer);
        const saved = {
          id,
          createdAt: Date.now(),
          file,
          firstName,
          lastName,
          guestFolder: folder,
        };
        const photos = readManifest();
        photos.push(saved);
        writeManifest(photos);
        return saved;
      });

      sendJson(res, 201, publicPhoto(photo));
      return;
    }

    const deleteMatch = pathname.match(/^\/api\/photos\/([a-z0-9]+)$/);
    const deleteId = deleteMatch ? deleteMatch[1] : url.searchParams.get("id");
    if (req.method === "DELETE" && deleteId && /^[a-z0-9]+$/.test(deleteId)) {
      if (!isAdmin(req)) {
        sendJson(res, 403, { error: "admin required" });
        return;
      }
      const id = deleteId;
      const removed = await enqueue(async () => {
        const photos = readManifest();
        const photo = photos.find((item) => item.id === id);
        if (!photo) {
          return null;
        }
        await fs.promises.rm(path.join(uploads, photo.file.replace(/\//g, path.sep)), { force: true });
        writeManifest(photos.filter((item) => item.id !== id));
        return photo;
      });
      sendJson(res, removed ? 200 : 404, removed ? publicPhoto(removed) : { error: "not found" });
      return;
    }

    let filePath = pathname === "/" ? path.join(root, "index.html") : resolveInsideRoot(pathname);
    if (!filePath) {
      sendJson(res, 400, { error: "bad path" });
      return;
    }
    if (pathname === "/album") {
      filePath = path.join(root, "album.html");
    }
    if (pathname === "/adminpanel") {
      filePath = path.join(root, "adminpanel.html");
    }

    fs.stat(filePath, (error, stat) => {
      if (!error && stat.isDirectory()) {
        sendFile(res, path.join(filePath, "index.html"));
        return;
      }
      sendFile(res, filePath);
    });
  } catch (error) {
    const status = error.status || 500;
    if (!res.headersSent) {
      sendJson(res, status, { error: status === 413 ? "image too large" : "server error" });
    }
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log("Album server: http://0.0.0.0:" + port);
});
