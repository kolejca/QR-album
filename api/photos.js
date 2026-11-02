const { del, list, put } = require("@vercel/blob");

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

function photoFromBlob(blob) {
  const name = blob.pathname.split("/").pop() || "";
  return {
    id: name.replace(/\.[^.]+$/, ""),
    createdAt: new Date(blob.uploadedAt).getTime(),
    url: blob.url,
  };
}

async function listPhotos() {
  const photos = [];
  let cursor;
  do {
    const page = await list({ prefix: "photos/", cursor, limit: 1000 });
    photos.push(...page.blobs.map(photoFromBlob));
    cursor = page.cursor;
  } while (cursor);
  photos.sort((a, b) => b.createdAt - a.createdAt);
  return photos;
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
      send(res, 201, { id, createdAt: Date.now(), url: blob.url });
      return;
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!/^[a-z0-9]+$/.test(id)) {
        send(res, 400, { error: "bad id" });
        return;
      }
      const page = await list({ prefix: "photos/" + id + "." });
      await Promise.all(page.blobs.map((blob) => del(blob.url)));
      send(res, 200, { id });
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
