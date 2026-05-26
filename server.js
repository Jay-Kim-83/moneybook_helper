const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DB_PATH = path.join(__dirname, "data", "db.json");
const DEFAULT_DATA = { banks: [], cards: [], fixedExpenses: [], monthly: [] };
const COLLECTIONS = ["banks", "cards", "fixedExpenses"];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const readDB = () => {
    if (!fs.existsSync(DB_PATH)) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DATA, null, 4));
    }
    return { ...DEFAULT_DATA, ...JSON.parse(fs.readFileSync(DB_PATH, "utf-8")) };
};

const writeDB = (data) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 4));

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const send = (res, status, data) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
};

const readBody = (req) =>
    new Promise((resolve) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
    });

const cascadeBankDelete = (db, id) => {
    db.cards = db.cards.filter((c) => c.bankId !== id);
    db.fixedExpenses = db.fixedExpenses.filter((e) => e.bankId !== id);
};

const handleApi = async (req, res, parts) => {
    const [, collection, id] = parts;
    const method = req.method;

    if (collection === "data" && method === "GET") return send(res, 200, readDB());

    if (collection === "monthly") {
        const db = readDB();
        if (method === "GET") return send(res, 200, db.monthly.find((m) => m.month === id) || null);
        if (method === "POST") {
            const body = await readBody(req);
            const idx = db.monthly.findIndex((m) => m.month === body.month);
            if (idx === -1) db.monthly.push(body);
            else db.monthly[idx] = body;
            db.monthly.sort((a, b) => b.month.localeCompare(a.month));
            writeDB(db);
            return send(res, 200, body);
        }
    }

    if (COLLECTIONS.includes(collection)) {
        const db = readDB();
        if (method === "POST") {
            const item = { id: genId(), ...(await readBody(req)) };
            db[collection].push(item);
            writeDB(db);
            return send(res, 200, item);
        }
        if (method === "PUT") {
            const idx = db[collection].findIndex((x) => x.id === id);
            if (idx === -1) return send(res, 404, { error: "찾을 수 없습니다" });
            db[collection][idx] = { ...db[collection][idx], ...(await readBody(req)), id };
            writeDB(db);
            return send(res, 200, db[collection][idx]);
        }
        if (method === "DELETE") {
            if (collection === "banks") cascadeBankDelete(db, id);
            db[collection] = db[collection].filter((x) => x.id !== id);
            writeDB(db);
            return send(res, 200, { ok: true });
        }
    }

    send(res, 404, { error: "잘못된 요청" });
};

const serveStatic = (req, res) => {
    const rel = req.url === "/" ? "index.html" : decodeURIComponent(req.url.slice(1));
    const filePath = path.join(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end("Not Found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
};

http.createServer(async (req, res) => {
    try {
        if (req.url.startsWith("/api/")) return await handleApi(req, res, req.url.split("?")[0].split("/").slice(1));
        serveStatic(req, res);
    } catch (err) {
        send(res, 500, { error: err.message });
    }
}).listen(PORT, () => console.log(`가계부 도우미 실행 중: http://localhost:${PORT}`));
