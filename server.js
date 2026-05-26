const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const RESTART_CODE = 42;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const MONTHLY_DIR = path.join(DATA_DIR, "monthly");
const SECRET_PATH = path.join(DATA_DIR, ".session_secret");
const DEFAULT_DATA = { banks: [], cards: [], fixedExpenses: [] };
const COLLECTIONS = ["banks", "cards", "fixedExpenses"];
const FIELDS = {
    banks: ["name", "alias", "accountLast4"],
    cards: ["company", "alias", "cardLast4", "bankId"],
    fixedExpenses: ["name", "amount", "bankId", "description"],
};
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const ensureDir = (dir) => fs.existsSync(dir) || fs.mkdirSync(dir, { recursive: true });

const parseJson = (raw) => JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const SESSION_SECRET = (() => {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    ensureDir(DATA_DIR);
    if (fs.existsSync(SECRET_PATH)) return fs.readFileSync(SECRET_PATH, "utf-8").trim();
    const secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(SECRET_PATH, secret);
    return secret;
})();
let adminPassword = process.env.ADMIN_PASSWORD || "";
if (!adminPassword && !IS_PROD) {
    adminPassword = "moneybook";
    console.warn("⚠ ADMIN_PASSWORD 미설정 — 개발용 기본 비밀번호 'moneybook' 사용 중 (배포 시 반드시 환경변수로 설정)");
}

const readDB = () => {
    if (!fs.existsSync(DB_PATH)) {
        ensureDir(DATA_DIR);
        fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DATA, null, 4));
    }
    return { ...DEFAULT_DATA, ...parseJson(fs.readFileSync(DB_PATH, "utf-8")) };
};

const writeDB = (data) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 4));

const isMonth = (m) => /^\d{4}-\d{2}$/.test(m);
const monthlyFile = (m) => path.join(MONTHLY_DIR, `${m}.json`);
const readMonthly = (m) => (isMonth(m) && fs.existsSync(monthlyFile(m)) ? parseJson(fs.readFileSync(monthlyFile(m), "utf-8")) : null);
const listMonthly = () => {
    ensureDir(MONTHLY_DIR);
    return fs
        .readdirSync(MONTHLY_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => parseJson(fs.readFileSync(path.join(MONTHLY_DIR, f), "utf-8")))
        .sort((a, b) => b.month.localeCompare(a.month));
};

const migrateMonthly = () => {
    ensureDir(MONTHLY_DIR);
    if (!fs.existsSync(DB_PATH)) return;
    const db = parseJson(fs.readFileSync(DB_PATH, "utf-8"));
    if (Array.isArray(db.monthly) && db.monthly.length) {
        for (const rec of db.monthly) if (rec && isMonth(rec.month)) fs.writeFileSync(monthlyFile(rec.month), JSON.stringify(rec, null, 4));
    }
    if ("monthly" in db) {
        delete db.monthly;
        writeDB(db);
    }
};

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const send = (res, status, data) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
};

const readBody = (req) =>
    new Promise((resolve) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                resolve({});
            }
        });
    });

const normalize = (collection, body) => {
    const data = FIELDS[collection].reduce((o, k) => (k in body ? { ...o, [k]: body[k] } : o), {});
    if (collection === "banks" && data.accountLast4 != null) data.accountLast4 = String(data.accountLast4).replace(/\D/g, "").slice(-4);
    if (collection === "cards" && data.cardLast4 != null) data.cardLast4 = String(data.cardLast4).replace(/\D/g, "").slice(-4);
    if (collection === "fixedExpenses" && data.amount != null) data.amount = Number(data.amount) || 0;
    return data;
};

const sign = (value) => `${value}.${crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url")}`;
const issueToken = () => sign(String(Date.now() + SESSION_TTL));
const validToken = (signed) => {
    if (!signed || !signed.includes(".")) return false;
    const value = signed.slice(0, signed.lastIndexOf("."));
    try {
        const expected = sign(value);
        if (signed.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) return false;
    } catch {
        return false;
    }
    return Number(value) > Date.now();
};
const getCookie = (req, name) => {
    const found = (req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
    return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
};
const isAuthed = (req) => validToken(getCookie(req, "session"));
const sessionCookie = (token) => {
    const parts = [`session=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${SESSION_TTL / 1000}`];
    if (IS_PROD) parts.push("Secure");
    return parts.join("; ");
};
const safeEqual = (a, b) => {
    const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

const git = (args) =>
    new Promise((resolve) => {
        execFile("git", args, { cwd: __dirname, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ ok: !err, out: `${stdout || ""}${stderr || ""}`.trim() });
        });
    });

const systemInfo = async () => {
    const status = await git(["status", "--porcelain"]);
    return {
        node: process.version,
        branch: (await git(["rev-parse", "--abbrev-ref", "HEAD"])).out || "(git 아님)",
        lastCommit: (await git(["log", "-1", "--pretty=%h  %s  (%cr)"])).out || "(커밋 없음)",
        changes: status.out ? status.out.split("\n").filter(Boolean).length : 0,
        production: IS_PROD,
    };
};

const deploy = async (message) => {
    const msg = (message && message.trim()) || `update ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    let log = "";
    const run = async (args) => {
        const r = await git(args);
        log += `$ git ${args.join(" ")}\n${r.out || "(출력 없음)"}\n\n`;
        return r;
    };
    await run(["add", "-A"]);
    const commit = await run(["commit", "-m", msg]);
    if (!commit.ok && !/nothing to commit/i.test(commit.out)) return { ok: false, log };
    const push = await run(["push"]);
    return { ok: push.ok, log };
};

const handleAuth = async (req, res, action) => {
    if (action === "login" && req.method === "POST") {
        const { password } = await readBody(req);
        if (!adminPassword) return send(res, 500, { error: "서버에 ADMIN_PASSWORD가 설정되지 않았습니다" });
        if (typeof password !== "string" || !safeEqual(password, adminPassword)) return send(res, 401, { error: "비밀번호가 올바르지 않습니다" });
        res.setHeader("Set-Cookie", sessionCookie(issueToken()));
        return send(res, 200, { ok: true });
    }
    if (action === "logout" && req.method === "POST") {
        res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0");
        return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "잘못된 요청" });
};

const handleSystem = async (req, res, action) => {
    if (action === "info" && req.method === "GET") return send(res, 200, await systemInfo());
    if (action === "deploy" && req.method === "POST") {
        const { message } = await readBody(req);
        return send(res, 200, await deploy(message));
    }
    if (action === "restart" && req.method === "POST") {
        send(res, 200, { ok: true });
        return setTimeout(() => process.exit(RESTART_CODE), 200);
    }
    send(res, 404, { error: "잘못된 요청" });
};

const handleApi = async (req, res, parts) => {
    const [, collection, id] = parts;
    const method = req.method;

    if (collection === "data" && method === "GET") return send(res, 200, readDB());

    if (collection === "monthly") {
        if (method === "GET") return send(res, 200, id ? readMonthly(id) : listMonthly());
        if (method === "POST") {
            const body = await readBody(req);
            if (!isMonth(body.month)) return send(res, 400, { error: "잘못된 월 형식" });
            ensureDir(MONTHLY_DIR);
            fs.writeFileSync(monthlyFile(body.month), JSON.stringify(body, null, 4));
            return send(res, 200, body);
        }
        if (method === "DELETE") {
            if (isMonth(id) && fs.existsSync(monthlyFile(id))) fs.unlinkSync(monthlyFile(id));
            return send(res, 200, { ok: true });
        }
    }

    if (COLLECTIONS.includes(collection)) {
        const db = readDB();
        if (method === "POST") {
            const item = { id: genId(), ...normalize(collection, await readBody(req)) };
            db[collection].push(item);
            writeDB(db);
            return send(res, 200, item);
        }
        if (method === "PUT") {
            const idx = db[collection].findIndex((x) => x.id === id);
            if (idx === -1) return send(res, 404, { error: "찾을 수 없습니다" });
            db[collection][idx] = { ...db[collection][idx], ...normalize(collection, await readBody(req)), id };
            writeDB(db);
            return send(res, 200, db[collection][idx]);
        }
        if (method === "DELETE") {
            if (collection === "banks") {
                db.cards = db.cards.filter((c) => c.bankId !== id);
                db.fixedExpenses = db.fixedExpenses.filter((e) => e.bankId !== id);
            }
            db[collection] = db[collection].filter((x) => x.id !== id);
            writeDB(db);
            return send(res, 200, { ok: true });
        }
    }

    send(res, 404, { error: "잘못된 요청" });
};

const serveStatic = (req, res, urlPath) => {
    const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
    const filePath = path.join(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end("Not Found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
};

migrateMonthly();

http.createServer(async (req, res) => {
    try {
        const urlPath = req.url.split("?")[0];
        if (urlPath === "/api/login" || urlPath === "/api/logout") return await handleAuth(req, res, urlPath.split("/")[2]);
        if (urlPath.startsWith("/api/")) {
            if (!isAuthed(req)) return send(res, 401, { error: "로그인이 필요합니다" });
            if (urlPath.startsWith("/api/system/")) return await handleSystem(req, res, urlPath.split("/")[3]);
            return await handleApi(req, res, urlPath.split("/").slice(1));
        }
        if ((urlPath === "/" || urlPath === "/index.html") && !isAuthed(req)) {
            res.writeHead(302, { Location: "/login.html" });
            return res.end();
        }
        serveStatic(req, res, urlPath);
    } catch (err) {
        send(res, 500, { error: err.message });
    }
}).listen(PORT, () => console.log(`가계부 도우미 실행 중: http://localhost:${PORT}`));
