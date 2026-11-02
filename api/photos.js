const { del, list, put } = require("@vercel/blob");

const MANIFEST_PATH = "photos/manifest.json";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readJson(req) {
  if (Buffer.isBuffer(req.body)) {
    return Promise.resolve(JSON.parse(req.body.toString("utf8")));
  }
  if (req.body && typeof req.body === "object") {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string" && req.body) {
    return Promise.resolve(JSON.parse(req.body));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function publicPhoto(photo) {
  return {
    id: photo.id,
    createdAt: photo.createdAt,
    url: photo.url,
    firstName: photo.firstName || "",
    lastName: photo.lastName || "",
  };
}

async function getManifest() {
  const page = await list({ prefix: "photos/", limit: 1000 });
  const manifestBlob = page.blobs.find((blob) => blob.pathname.endsWith("/manifest.json"));
  if (!manifestBlob) {
    return [];
  }
  const response = await fetch(manifestBlob.url, { cache: "no-store" });
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function setManifest(photos) {
  await put(MANIFEST_PATH, JSON.stringify(photos), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function listPhotos() {
  const photos = await getManifest();
  const knownIds = new Set(photos.map((photo) => photo.id));
  const page = await list({ prefix: "photos/", limit: 1000 });
  for (const blob of page.blobs) {
    if (!blob.pathname.endsWith(".jpg")) {
      continue;
    }
    const id = blob.pathname.split("/").pop().replace(/\.jpg$/, "");
    if (knownIds.has(id)) {
      continue;
    }
    photos.push({
      id,
      createdAt: new Date(blob.uploadedAt).getTime(),
      url: blob.url,
      firstName: "",
      lastName: "",
    });
  }
  photos.sort((a, b) => b.createdAt - a.createdAt);
  return photos.map(publicPhoto);
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method === "GET") {
      send(res, 200, await listPhotos());
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const firstName = sanitizeName(body.firstName);
      const lastName = sanitizeName(body.lastName);
      if (!firstName || !lastName) {
        send(res, 400, { error: "name required" });
        return;
      }

      const match = String(body.image || "").match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        send(res, 400, { error: "bad image" });
        return;
      }

      const image = Buffer.from(match[1], "base64");
      if (!image.length || image.length > 4 * 1024 * 1024) {
        send(res, 413, { error: "image too large" });
        return;
      }

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const blob = await put("photos/" + id + ".jpg", image, {
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: false,
      });

      const saved = {
        id,
        createdAt: Date.now(),
        url: blob.url,
        firstName,
        lastName,
      };

      const photos = await getManifest();
      photos.push(saved);
      await setManifest(photos);
      send(res, 201, publicPhoto(saved));
      return;
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!/^[a-z0-9]+$/.test(id)) {
        send(res, 400, { error: "bad id" });
        return;
      }

      const photos = await getManifest();
      const photo = photos.find((item) => item.id === id);
      if (!photo) {
        send(res, 404, { error: "not found" });
        return;
      }

      const blobs = await list({ prefix: "photos/" + id + ".", limit: 10 });
      await Promise.all(blobs.blobs.map((item) => del(item.url)));
      await setManifest(photos.filter((item) => item.id !== id));
      send(res, 200, publicPhoto(photo));
      return;
    }

    send(res, 405, { error: "method" });
  } catch (error) {
    send(res, 500, { error: "storage" });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};
