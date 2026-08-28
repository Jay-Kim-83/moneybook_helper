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
const TRANSACTIONS_PATH = path.join(DATA_DIR, "transactions.json");
const MONTHLY_DIR = path.join(DATA_DIR, "monthly");
const SECRET_PATH = path.join(DATA_DIR, ".session_secret");
const DATABASE_URL = process.env.DATABASE_URL || "";
const DEFAULT_DATA = { banks: [], cards: [], fixedExpenses: [], currentBalances: {} };
const COLLECTIONS = ["banks", "cards", "fixedExpenses"];
const FIELDS = {
    banks: ["name", "alias", "accountLast4", "relayExclude", "relayTarget", "retainAmount", "fixedTransfers"],
    cards: ["company", "alias", "cardLast4", "bankId"],
    fixedExpenses: ["name", "amount", "bankId", "description"],
};
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const ensureDir = (dir) => fs.existsSync(dir) || fs.mkdirSync(dir, { recursive: true });
const parseJson = (raw) => JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
const isMonth = (m) => /^\d{4}-\d{2}$/.test(m);
const normalizeData = (data) => ({ ...DEFAULT_DATA, ...data, monthly: undefined });

const fileStore = {
    async init() {
        ensureDir(MONTHLY_DIR);
        if (!fs.existsSync(DB_PATH)) return;
        const db = parseJson(fs.readFileSync(DB_PATH, "utf-8"));
        if (Array.isArray(db.monthly) && db.monthly.length) {
            for (const rec of db.monthly) if (rec && isMonth(rec.month)) fs.writeFileSync(this.monthlyFile(rec.month), JSON.stringify(rec, null, 4));
        }
        if ("monthly" in db) {
            delete db.monthly;
            await this.writeDB(db);
        }
    },
    secret() {
        if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
        ensureDir(DATA_DIR);
        if (fs.existsSync(SECRET_PATH)) return fs.readFileSync(SECRET_PATH, "utf-8").trim();
        const secret = crypto.randomBytes(32).toString("hex");
        fs.writeFileSync(SECRET_PATH, secret);
        return secret;
    },
    async readDB() {
        if (!fs.existsSync(DB_PATH)) {
            ensureDir(DATA_DIR);
            fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DATA, null, 4));
        }
        return { ...DEFAULT_DATA, ...parseJson(fs.readFileSync(DB_PATH, "utf-8")) };
    },
    async writeDB(data) {
        ensureDir(DATA_DIR);
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 4));
    },
    monthlyFile: (m) => path.join(MONTHLY_DIR, `${m}.json`),
    async readMonthly(m) {
        return isMonth(m) && fs.existsSync(this.monthlyFile(m)) ? parseJson(fs.readFileSync(this.monthlyFile(m), "utf-8")) : null;
    },
    async listMonthly() {
        ensureDir(MONTHLY_DIR);
        return fs
            .readdirSync(MONTHLY_DIR)
            .filter((f) => f.endsWith(".json"))
            .map((f) => parseJson(fs.readFileSync(path.join(MONTHLY_DIR, f), "utf-8")))
            .sort((a, b) => b.month.localeCompare(a.month));
    },
    async writeMonthly(rec) {
        ensureDir(MONTHLY_DIR);
        fs.writeFileSync(this.monthlyFile(rec.month), JSON.stringify(rec, null, 4));
    },
    async deleteMonthly(m) {
        if (isMonth(m) && fs.existsSync(this.monthlyFile(m))) fs.unlinkSync(this.monthlyFile(m));
    },
    async listTransactions(month) {
        if (!fs.existsSync(TRANSACTIONS_PATH)) return [];
        const all = parseJson(fs.readFileSync(TRANSACTIONS_PATH, "utf-8"));
        return (month ? all.filter((t) => String(t.at || "").startsWith(month)) : all).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },
    async addTransaction(tx) {
        ensureDir(DATA_DIR);
        const all = fs.existsSync(TRANSACTIONS_PATH) ? parseJson(fs.readFileSync(TRANSACTIONS_PATH, "utf-8")) : [];
        all.push(tx);
        fs.writeFileSync(TRANSACTIONS_PATH, JSON.stringify(all, null, 4));
    },
    async deleteTransaction(id) {
        if (!fs.existsSync(TRANSACTIONS_PATH)) return;
        const all = parseJson(fs.readFileSync(TRANSACTIONS_PATH, "utf-8"));
        fs.writeFileSync(TRANSACTIONS_PATH, JSON.stringify(all.filter((t) => t.id !== id), null, 4));
    },
};

const createPgStore = () => {
    const { Pool } = require("pg");
    const ssl = /sslmode=disable/.test(DATABASE_URL) ? false : { rejectUnauthorized: false };
    const pool = new Pool({ connectionString: DATABASE_URL, ssl });
    const q = (text, params) => pool.query(text, params);
    return {
        async init() {
            await q("CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, value jsonb NOT NULL)");
            await q("CREATE TABLE IF NOT EXISTS monthly (month text PRIMARY KEY, data jsonb NOT NULL)");
            await q("CREATE TABLE IF NOT EXISTS transactions (id text PRIMARY KEY, data jsonb NOT NULL)");
            const seeded = await q("SELECT 1 FROM kv WHERE key='db'");
            if (!seeded.rows.length) {
                let seed = { ...DEFAULT_DATA };
                if (fs.existsSync(DB_PATH)) seed = normalizeData(parseJson(fs.readFileSync(DB_PATH, "utf-8")));
                await q("INSERT INTO kv(key, value) VALUES('db', $1)", [JSON.stringify(seed)]);
            }
            const count = await q("SELECT count(*)::int AS n FROM monthly");
            if (count.rows[0].n === 0 && fs.existsSync(MONTHLY_DIR)) {
                for (const f of fs.readdirSync(MONTHLY_DIR).filter((x) => x.endsWith(".json"))) {
                    const rec = parseJson(fs.readFileSync(path.join(MONTHLY_DIR, f), "utf-8"));
                    if (rec && isMonth(rec.month)) await q("INSERT INTO monthly(month, data) VALUES($1, $2) ON CONFLICT (month) DO NOTHING", [rec.month, JSON.stringify(rec)]);
                }
            }
        },
        async secret() {
            if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
            const found = await q("SELECT value FROM kv WHERE key='session_secret'");
            if (found.rows.length) return found.rows[0].value;
            const secret = crypto.randomBytes(32).toString("hex");
            await q("INSERT INTO kv(key, value) VALUES('session_secret', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(secret)]);
            return (await q("SELECT value FROM kv WHERE key='session_secret'")).rows[0].value;
        },
        async readDB() {
            const { rows } = await q("SELECT value FROM kv WHERE key='db'");
            return rows.length ? { ...DEFAULT_DATA, ...rows[0].value } : { ...DEFAULT_DATA };
        },
        async writeDB(data) {
            await q("INSERT INTO kv(key, value) VALUES('db', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(data)]);
        },
        async readMonthly(m) {
            if (!isMonth(m)) return null;
            const { rows } = await q("SELECT data FROM monthly WHERE month = $1", [m]);
            return rows.length ? rows[0].data : null;
        },
        async listMonthly() {
            const { rows } = await q("SELECT data FROM monthly ORDER BY month DESC");
            return rows.map((r) => r.data);
        },
        async writeMonthly(rec) {
            await q("INSERT INTO monthly(month, data) VALUES($1, $2) ON CONFLICT (month) DO UPDATE SET data = $2", [rec.month, JSON.stringify(rec)]);
        },
        async deleteMonthly(m) {
            if (isMonth(m)) await q("DELETE FROM monthly WHERE month = $1", [m]);
        },
        async listTransactions(month) {
            const { rows } = await q("SELECT data FROM transactions WHERE $1 = '' OR data->>'at' LIKE $1 || '%' ORDER BY data->>'at' DESC", [month || ""]);
            return rows.map((r) => r.data);
        },
        async addTransaction(tx) {
            await q("INSERT INTO transactions(id, data) VALUES($1, $2) ON CONFLICT (id) DO NOTHING", [tx.id, JSON.stringify(tx)]);
        },
        async deleteTransaction(id) {
            await q("DELETE FROM transactions WHERE id = $1", [id]);
        },
    };
};

const store = DATABASE_URL ? createPgStore() : fileStore;
let SESSION_SECRET = "";
let adminPassword = process.env.ADMIN_PASSWORD || "";
if (!adminPassword && !IS_PROD) {
    adminPassword = "moneybook";
    console.warn("⚠ ADMIN_PASSWORD 미설정 — 개발용 기본 비밀번호 'moneybook' 사용 중 (배포 시 반드시 환경변수로 설정)");
}
let ingestKey = process.env.INGEST_KEY || "";
if (!ingestKey && !IS_PROD) {
    ingestKey = "moneybook-ingest";
    console.warn("⚠ INGEST_KEY 미설정 — 개발용 기본 키 'moneybook-ingest' 사용 중 (배포 시 반드시 환경변수로 설정)");
}

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const send = (res, status, data) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
};

const readRawBody = (req) =>
    new Promise((resolve) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

const readBody = async (req) => {
    try {
        const raw = await readRawBody(req);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const normalize = (collection, body) => {
    const data = FIELDS[collection].reduce((o, k) => (k in body ? { ...o, [k]: body[k] } : o), {});
    if (collection === "banks") {
        if (data.accountLast4 != null) data.accountLast4 = String(data.accountLast4).replace(/\D/g, "").slice(-4);
        if ("relayExclude" in data) data.relayExclude = !!data.relayExclude;
        if ("relayTarget" in data) data.relayTarget = String(data.relayTarget || "");
        if ("retainAmount" in data) data.retainAmount = Number(data.retainAmount) || 0;
        if ("fixedTransfers" in data)
            data.fixedTransfers = (Array.isArray(data.fixedTransfers) ? data.fixedTransfers : [])
                .map((t) => ({ bankId: String(t?.bankId || ""), amount: Number(t?.amount) || 0 }))
                .filter((t) => t.bankId && t.amount > 0);
    }
    if (collection === "cards" && data.cardLast4 != null) data.cardLast4 = String(data.cardLast4).replace(/\D/g, "").slice(-4);
    if (collection === "fixedExpenses" && data.amount != null) data.amount = Number(data.amount) || 0;
    return data;
};

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
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
        storage: DATABASE_URL ? "postgres" : "file",
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

const AD_RE = /복권|응모|추첨|이벤트|쿠폰|광고|캐시백|걸음|혜택|당첨|받아가|받아보|받아요|누르면|사라져요|확인해보|확인해봐|모아보|보상|포인트|출석|퀴즈|무료|가입|추천|알아보/;
const parseNum = (s) => Number(String(s).replace(/,/g, "")) || 0;
const pad2 = (n) => String(n).padStart(2, "0");

const parseSms = (sender, text, db) => {
    const t = text.replace(/\[Web발신\]/g, "").trim();
    const balM = t.match(/잔액\s*([\d,]+)/);
    const balance = balM ? parseNum(balM[1]) : null;
    const noBal = t.replace(/잔액\s*[\d,]+\s*원?/g, "");

    let kind = null, amount = null, weak = false, m;
    if ((m = noBal.match(/(자동출금|출금액|입금액|출금|입금|결제|승인)\s*([\d,]+)\s*원/))) {
        amount = parseNum(m[2]);
        kind = /입금/.test(m[1]) ? "입금" : "출금";
    } else if ((m = noBal.match(/(입금|출금)\s+([\d,]+)/))) {
        amount = parseNum(m[2]);
        kind = m[1] === "입금" ? "입금" : "출금";
    } else if ((m = noBal.match(/([\d,]+)\s*원/))) {
        amount = parseNum(m[1]);
        kind = /입금|충전/.test(noBal) ? "입금" : "출금";
        weak = true;
    }
    if ((amount === null || weak) && AD_RE.test(sender + " " + t)) return null;
    if (amount !== null && /취소/.test(t)) amount = -amount;
    if (amount !== null && /예정/.test(noBal)) kind = "안내";
    if (kind === "출금" && balance === null && /승인/.test(noBal)) kind = "카드";

    let title = "";
    const paren = t.match(/자동출금\s*[\d,]+\s*원\(([^)]+)\)/);
    if (paren) title = paren[1];
    if (!title) {
        title =
            t
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(
                    (l) =>
                        l &&
                        !/잔액/.test(l) &&
                        !/\d{2}\/\d{2}/.test(l) &&
                        !/^[\d\-*,.\s원:]+$/.test(l) &&
                        !/^(자동출금|출금액|입금액|출금|입금|결제|승인)/.test(l)
                )
                .pop() || "";
    }
    if (title.includes(">")) kind = "이체";

    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const dm = t.match(/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
    const at = dm
        ? `${now.getUTCFullYear()}-${dm[1]}-${dm[2]} ${dm[3]}:${dm[4]}`
        : `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())} ${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}`;

    let bankId = null;
    for (const acct of t.match(/[\d*][\d*\-]{5,}[\d*]/g) || []) {
        const l4 = acct.replace(/\D/g, "").slice(-4);
        const hit = db.banks.find((b) => b.accountLast4 && b.accountLast4 === l4);
        if (hit) {
            bankId = hit.id;
            break;
        }
    }
    if (!bankId) {
        const hay = sender + " " + t;
        const hit = db.banks.find((b) =>
            [b.name, b.name?.replace(/은행/g, ""), b.alias].filter((n) => n && n.length >= 2).some((n) => hay.includes(n))
        );
        if (hit) bankId = hit.id;
    }
    const card = db.cards.find((c) =>
        [c.company, c.alias]
            .filter(Boolean)
            .some((n) => (sender + " " + t).includes(n) || (kind === "카드" && n.length >= 2 && t.includes(n.slice(0, 2))))
    );

    return {
        kind: amount === null ? "미분류" : kind,
        amount,
        title: title || sender,
        bankId,
        cardId: card?.id || null,
        balance,
        at,
        status: amount === null ? "pending" : "ok",
    };
};

const bearerToken = (req) => {
    const h = req.headers.authorization || "";
    return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
};

const ingestAuthed = (req) => !!ingestKey && safeEqual(bearerToken(req), ingestKey);

const handleIngest = async (req, res) => {
    if (req.method !== "POST") return send(res, 405, { error: "POST 전용" });
    if (!ingestKey) return send(res, 503, { error: "INGEST_KEY가 설정되지 않았습니다" });
    const raw = await readRawBody(req);
    const lines = raw.split(/\r?\n/);
    let sender = "", text = raw, keyOk = ingestAuthed(req);
    if (lines[0] && lines[0].includes("|")) {
        const [key, , from = ""] = lines[0].split("|");
        sender = from.trim();
        text = lines.slice(1).join("\n");
        if (!keyOk) keyOk = safeEqual(key.trim(), ingestKey);
    }
    if (!keyOk) return send(res, 401, { error: "인증 실패" });
    if (!text.trim()) return send(res, 400, { error: "본문이 없습니다" });
    const db = await store.readDB();
    const parsed = parseSms(sender, text, db);
    if (!parsed) return send(res, 200, { ok: true, dropped: true });
    const tx = { id: genId(), sender, raw: text.trim(), category: "", ...parsed };
    await store.addTransaction(tx);
    if (tx.bankId && tx.balance != null && tx.status === "ok") {
        db.currentBalances = db.currentBalances || {};
        const cur = db.currentBalances[tx.bankId];
        if (!cur || String(tx.at) >= String(cur.at)) {
            db.currentBalances[tx.bankId] = { amount: tx.balance, at: tx.at };
            await store.writeDB(db);
        }
    }
    send(res, 200, { ok: true, alert: tx.status === "pending" && /(?:\d{1,3}(?:,\d{3})+|\d{4,})/.test(tx.raw), transaction: tx });
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

    if (collection === "data" && method === "GET") return send(res, 200, await store.readDB());

    if (collection === "transactions") {
        if (method === "GET") {
            const month = new URL(req.url, "http://localhost").searchParams.get("month") || "";
            return send(res, 200, await store.listTransactions(month));
        }
        if (method === "DELETE" && id) {
            await store.deleteTransaction(id);
            return send(res, 200, { ok: true });
        }
    }

    if (collection === "monthly") {
        if (method === "GET") return send(res, 200, id ? await store.readMonthly(id) : await store.listMonthly());
        if (method === "POST") {
            const body = await readBody(req);
            if (!isMonth(body.month)) return send(res, 400, { error: "잘못된 월 형식" });
            await store.writeMonthly(body);
            return send(res, 200, body);
        }
        if (method === "DELETE") {
            await store.deleteMonthly(id);
            return send(res, 200, { ok: true });
        }
    }

    if (collection === "banks" && id === "reorder" && method === "POST") {
        const { ids } = await readBody(req);
        if (!Array.isArray(ids)) return send(res, 400, { error: "잘못된 순서 데이터" });
        const db = await store.readDB();
        db.banks = [
            ...ids.map((i) => db.banks.find((b) => b.id === i)).filter(Boolean),
            ...db.banks.filter((b) => !ids.includes(b.id)),
        ];
        await store.writeDB(db);
        return send(res, 200, { ok: true });
    }

    if (COLLECTIONS.includes(collection)) {
        const db = await store.readDB();
        if (method === "POST") {
            const item = { id: genId(), ...normalize(collection, await readBody(req)) };
            db[collection].push(item);
            await store.writeDB(db);
            return send(res, 200, item);
        }
        if (method === "PUT") {
            const idx = db[collection].findIndex((x) => x.id === id);
            if (idx === -1) return send(res, 404, { error: "찾을 수 없습니다" });
            db[collection][idx] = { ...db[collection][idx], ...normalize(collection, await readBody(req)), id };
            await store.writeDB(db);
            return send(res, 200, db[collection][idx]);
        }
        if (method === "DELETE") {
            if (collection === "banks") {
                db.cards = db.cards.filter((c) => c.bankId !== id);
                db.fixedExpenses = db.fixedExpenses.filter((e) => e.bankId !== id);
            }
            db[collection] = db[collection].filter((x) => x.id !== id);
            await store.writeDB(db);
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

const server = http.createServer(async (req, res) => {
    try {
        const urlPath = req.url.split("?")[0];
        if (urlPath === "/api/login" || urlPath === "/api/logout") return await handleAuth(req, res, urlPath.split("/")[2]);
        if (urlPath === "/api/ingest") return await handleIngest(req, res);
        if (urlPath.startsWith("/api/")) {
            if (!isAuthed(req) && !(urlPath.startsWith("/api/transactions") && ingestAuthed(req))) return send(res, 401, { error: "로그인이 필요합니다" });
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
});

(async () => {
    await store.init();
    SESSION_SECRET = await store.secret();
    server.listen(PORT, () => console.log(`가계부 도우미 실행 중 (${DATABASE_URL ? "postgres" : "file"} 저장): http://localhost:${PORT}`));
})().catch((err) => {
    console.error("서버 시작 실패:", err);
    process.exit(1);
});
