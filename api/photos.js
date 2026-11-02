const { del, list, put } = require("@vercel/blob");

const MANIFEST_PATH = "photos/manifest.json";
const ADMIN_PIN = process.env.QR_ALBUM_ADMIN_PIN || "";

function isAdmin(req) {
  const pin = req.headers["x-admin-pin"];
  return Boolean(ADMIN_PIN && pin === ADMIN_PIN);
}

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
    url: photo.url,
    firstName: photo.firstName || "",
    lastName: photo.lastName || "",
    guestFolder: photo.guestFolder || "",
  };
}

function photoFromPathname(pathname, blob) {
  const nested = pathname.match(/photos\/([^/]+)\/([^/]+)\.jpg$/);
  if (nested) {
    const folder = nested[1];
    const id = nested[2].replace(/\.jpg$/, "");
    if (folder === "manifest.json") {
      return null;
    }
    return {
      id,
      createdAt: new Date(blob.uploadedAt).getTime(),
      url: blob.url,
      firstName: "",
      lastName: "",
      guestFolder: folder,
    };
  }

  const flat = pathname.match(/photos\/([^/]+)\.jpg$/);
  if (!flat) {
    return null;
  }
  return {
    id: flat[1],
    createdAt: new Date(blob.uploadedAt).getTime(),
    url: blob.url,
    firstName: "",
    lastName: "",
    guestFolder: "",
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

async function listBlobPhotos() {
  const page = await list({ prefix: "photos/", limit: 1000 });
  const found = [];
  for (const blob of page.blobs) {
    const parsed = photoFromPathname(blob.pathname, blob);
    if (!parsed) {
      continue;
    }
    found.push({ ...parsed, url: blob.url });
  }
  return found;
}

async function resolvePhotoById(id) {
  const manifest = await getManifest();
  const fromManifest = manifest.find((item) => item.id === id);
  if (fromManifest) {
    return { photo: fromManifest, manifest };
  }

  for (const blobPhoto of await listBlobPhotos()) {
    if (blobPhoto.id === id) {
      return { photo: blobPhoto, manifest };
    }
  }

  return null;
}

async function deleteBlobForPhoto(photo) {
  const urls = new Set();
  if (photo.url) {
    urls.add(photo.url);
  }

  const prefixes = new Set();
  if (photo.guestFolder) {
    prefixes.add("photos/" + photo.guestFolder + "/" + photo.id + ".");
  }
  prefixes.add("photos/" + photo.id + ".");

  for (const prefix of prefixes) {
    const page = await list({ prefix, limit: 10 });
    for (const blob of page.blobs) {
      if (blob.pathname.endsWith("manifest.json")) {
        continue;
      }
      urls.add(blob.url);
    }
  }

  await Promise.all(
    [...urls].map(async (url) => {
      try {
        await del(url);
      } catch {
        // Blob may already be removed.
      }
    }),
  );
}

async function listPhotos() {
  const photos = await getManifest();
  const knownIds = new Set(photos.map((photo) => photo.id));
  for (const blobPhoto of await listBlobPhotos()) {
    if (knownIds.has(blobPhoto.id)) {
      continue;
    }
    photos.push(blobPhoto);
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
      const folder = guestFolder(firstName, lastName);
      const blob = await put("photos/" + folder + "/" + id + ".jpg", image, {
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
        guestFolder: folder,
      };

      const photos = await getManifest();
      photos.push(saved);
      await setManifest(photos);
      send(res, 201, publicPhoto(saved));
      return;
    }

    if (req.method === "DELETE") {
      if (!isAdmin(req)) {
        send(res, 403, { error: "admin required" });
        return;
      }

      const id = url.searchParams.get("id") || "";
      if (!/^[a-z0-9]+$/.test(id)) {
        send(res, 400, { error: "bad id" });
        return;
      }

      const resolved = await resolvePhotoById(id);
      if (!resolved) {
        send(res, 404, { error: "not found" });
        return;
      }

      await deleteBlobForPhoto(resolved.photo);
      await setManifest(resolved.manifest.filter((item) => item.id !== id));
      send(res, 200, publicPhoto(resolved.photo));
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
