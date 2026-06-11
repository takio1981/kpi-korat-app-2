const express = require("express");
const mysql = require("mysql2");
const mysqlPromise = require("mysql2/promise");
const cors = require("cors");
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const XLSX = require("xlsx");
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}); // 5MB
const BCRYPT_ROUNDS = 12;

const app = express();
app.set("trust proxy", 1); // trust first proxy (Nginx)
app.use(compression());

// --- การตั้งค่า CORS ---
// ถ้าไม่ได้ตั้ง CORS_ALLOWED_ORIGINS จะอนุญาตทุก origin (เหมาะสำหรับใช้งานผ่าน Nginx Proxy)
// ถ้าต้องการจำกัด ให้ระบุใน .env เช่น CORS_ALLOWED_ORIGINS=http://localhost:8808,http://192.168.1.100:8808
const corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS || "*";

let corsOptions;
if (corsAllowedOrigins === "*") {
  // อนุญาตทุก origin (ปลอดภัยเมื่อใช้ผ่าน Nginx Proxy — request เป็น same-origin อยู่แล้ว)
  corsOptions = { origin: true, credentials: true };
  console.log("CORS: Allowing all origins (via Nginx Proxy)");
} else {
  const allowedOrigins = corsAllowedOrigins
    .split(",")
    .map((origin) => origin.trim());
  console.log("CORS: Allowed Origins:", allowedOrigins);
  corsOptions = {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked request from origin: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
  };
}

app.use(cors(corsOptions));

// ─── Security Headers (helmet) ───────────────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);

// จำกัด request body ไม่เกิน 500KB — ป้องกัน DoS จาก large JSON payload
app.use(express.json({ limit: "500kb" }));
app.use(express.urlencoded({ extended: false, limit: "500kb" }));

// ─── JWT Secret ───────────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not set. Server cannot start.");
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET must be at least 32 characters. Generate with: openssl rand -base64 48");
  process.exit(1);
}
// Warn ถ้า secret ดูอ่อนแอ (dev default)
const WEAK_SECRETS = ["korat-kpi-dev-secret-2025", "secret", "changeme"];
if (WEAK_SECRETS.includes(process.env.JWT_SECRET) && process.env.NODE_ENV === "production") {
  console.error("FATAL: JWT_SECRET is using a known weak/default value in production.");
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

// ─── Encryption Key (สำหรับ encrypt remote DB password) ───────────────────────
// ENCRYPTION_KEY ต้องเป็น hex 64 ตัวอักษร (32 bytes สำหรับ AES-256)
// Generate ด้วย: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const ENCRYPTION_KEY_HEX = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY_HEX || ENCRYPTION_KEY_HEX.length !== 64) {
  console.error("FATAL: ENCRYPTION_KEY must be set as 64-character hex string (32 bytes). Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  process.exit(1);
}
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, "hex");

// encrypt: returns "iv:ciphertext:authTag" as base64
function encryptSecret(plaintext) {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${encrypted.toString("base64")}:${authTag.toString("base64")}`;
}

// Whitelist: สร้างตาราง s_kpi_report_korathealth_1..31 ตามที่ validate
const KORATHEALTH_TABLES = Object.freeze(
  Array.from({ length: 31 }, (_, i) => `s_kpi_report_korathealth_${i + 1}`)
);
function getKorathealthTable(kpiId) {
  const id = parseInt(kpiId);
  if (!Number.isInteger(id) || id < 1 || id > 31) {
    throw new Error(`Invalid KPI ID: ${kpiId}`);
  }
  return KORATHEALTH_TABLES[id - 1];
}

function decryptSecret(encoded) {
  if (!encoded) return "";
  // backward-compat: ถ้าเป็น plaintext เก่า (ไม่มี ":") คืนค่าเดิม
  if (!encoded.includes(":")) return encoded;
  try {
    const [ivB64, ctB64, tagB64] = encoded.split(":");
    const iv = Buffer.from(ivB64, "base64");
    const ct = Buffer.from(ctB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString("utf8");
  } catch (e) {
    console.error("[decryptSecret] failed:", e.message);
    return "";
  }
}

// ─── Rate Limiters ────────────────────────────────────────────────────────────
// Login: นับเฉพาะที่ "ล้มเหลว" (skipSuccessfulRequests)
//   - ออฟฟิศ NAT ที่มี 100+ user ใช้ IP เดียวกัน → login สำเร็จไม่กินโควต้า
//   - ป้องกัน brute-force ได้เพราะคนเดา password ผิดจะถูกนับและ block
//   - 100 ครั้งที่ผิด/15 นาที/IP = เผื่อความผิดพลาดของผู้ใช้จริง แต่ block bot ได้
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "พยายาม login ผิดพลาดมากเกินไป กรุณารอสักครู่แล้วลองใหม่",
  },
});

// API ทั่วไป: ขยายเป็น 2000 req/นาที/IP เพื่อรองรับ 100+ user หลัง NAT/Proxy
// (เฉลี่ย 20 req/นาที/user — เพียงพอสำหรับการใช้งานปกติ)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Request มากเกินไป กรุณารอสักครู่" },
});
// ข้าม Login เพื่อไม่ให้ถูก 2 limiter พร้อมกัน (loginLimiter เข้มกว่าอยู่แล้ว)
app.use("/kpikorat/api/", (req, res, next) => {
  if (req.path === "/login") return next();
  apiLimiter(req, res, next);
});

// ─── Validation Helpers ───────────────────────────────────────────────────────
function validFiscalYear(y) {
  const n = parseInt(y);
  return Number.isInteger(n) && n >= 2560 && n <= 2600 ? n : null;
}
function validPage(p) {
  const n = parseInt(p);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
function validLimit(l) {
  const n = parseInt(l);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 500) : 50;
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
const ADMIN_ROLES = ["admin", "admin_cup", "admin_ssj", "super_admin"];

function requireAuth(req, res, next) {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }
  try {
    req.user = jwt.verify(auth.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" });
  }
}

function requireAdmin(req, res, next) {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }
  try {
    req.user = jwt.verify(auth.split(" ")[1], JWT_SECRET);
    if (!ADMIN_ROLES.includes(req.user?.role)) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึง" });
    }
    next();
  } catch {
    res.status(401).json({ error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" });
  }
}

function requireSuperAdmin(req, res, next) {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }
  try {
    req.user = jwt.verify(auth.split(" ")[1], JWT_SECRET);
    if (!["admin", "super_admin"].includes(req.user?.role)) {
      return res.status(403).json({ error: "ต้องเป็น Super Admin เท่านั้น" });
    }
    next();
  } catch {
    res.status(401).json({ error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" });
  }
}

// ─── Apply Auth to Protected Routes ──────────────────────────────────────────
// Routes ที่ต้องการแค่ login (ผู้ใช้ทั่วไปก็เข้าได้)
const AUTH_ONLY_ADMIN_PATHS = [
  "/amphoes",
  "/hospitals",
  "/import-template",
  "/import-excel-preview",
  "/import-excel",
];
// Paths ที่ต้อง super_admin เท่านั้น (จัดการ remote sync + destructive operations)
const SUPER_ADMIN_ONLY_PATHS = [
  "/remote-sync",
  "/export-tables",
];

app.use("/kpikorat/api/admin", (req, res, next) => {
  const needsSuperAdmin = SUPER_ADMIN_ONLY_PATHS.some((p) =>
    req.path.startsWith(p),
  );
  if (needsSuperAdmin) return requireSuperAdmin(req, res, next);

  const needsAuthOnly = AUTH_ONLY_ADMIN_PATHS.some((p) =>
    req.path.startsWith(p),
  );
  if (needsAuthOnly) requireAuth(req, res, next);
  else requireAdmin(req, res, next);
});
// บันทึกข้อมูล KPI ต้อง login
app.use("/kpikorat/api/kpi-data/batch", requireAuth);

// ─── Helper: บันทึก Audit Log ─────────────────────────────────────────────────
async function writeLog(req, action, entityType, entityId, detail = "") {
  try {
    const u = req.user || {};
    const ip = req.ip || req.headers["x-forwarded-for"] || "";
    await db.query(
      "INSERT INTO system_logs (user_id, username, role, action, entity_type, entity_id, detail, ip_address) VALUES (?,?,?,?,?,?,?,?)",
      [
        u.id || null,
        u.username || "",
        u.role || "",
        action,
        entityType,
        entityId || null,
        detail,
        String(ip).split(",")[0].trim(),
      ],
    );
  } catch (_) {
    /* ไม่ block request ถ้า log ล้มเหลว */
  }
}

// ตั้งค่า Database
// หมายเหตุ: PM2 ทำ cluster mode → ทุก worker มี pool ของตัวเอง
//   total connections to MySQL = connectionLimit × PM2_INSTANCES
//   ดังนั้นต้องคำนวณให้ไม่เกิน MySQL `max_connections` (ดีฟอลต์ 151 — แนะนำตั้ง 300+ ที่ MySQL)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_LIMIT) || 75,
  queueLimit: 500, // ขยาย queue สำหรับช่วง burst — fail fast หลังจากนั้น
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});
const db = pool.promise();

app.get("/kpikorat/api/dashboard/summary", async (req, res) => {
  try {
    const fiscal_year = validFiscalYear(req.query.fiscal_year) || 2569;
    const district_id = req.query.district_id || "all";

    // แยก query กรณี 'all' vs specific district เพื่อให้ MySQL ใช้ index ได้
    let subWhere = "rec.fiscal_year = ?";
    const params = [fiscal_year];
    if (district_id !== "all") {
      subWhere += " AND u.amphoe_name = ?";
      params.push(district_id);
    }

    const sql = `
            SELECT
                iss.name AS issue_name,
                ind.name AS kpi_name,
                COALESCE(SUM(CASE WHEN r.report_month = 0 THEN r.kpi_value ELSE 0 END), 0) AS total_target,
                COALESCE(SUM(CASE WHEN r.report_month <> 0 THEN r.kpi_value ELSE 0 END), 0) AS total_result
            FROM kpi_main_indicators ind
            JOIN kpi_issues iss ON ind.issue_id = iss.id
            JOIN kpi_items it ON it.id = ind.id
            LEFT JOIN (
                SELECT rec.kpi_id, rec.kpi_value, rec.report_month
                FROM kpi_records rec
                LEFT JOIN users u ON rec.user_id = u.id
                WHERE ${subWhere}
            ) r ON it.id = r.kpi_id
            GROUP BY iss.id, ind.id, iss.name, ind.name
            ORDER BY iss.id ASC, ind.id ASC
        `;
    const [rows] = await db.execute(sql, params);

    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("Dashboard Summary Error:", e);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 1. API Login ---
// รองรับทั้ง bcrypt (password_version=1) และ SHA2 legacy (password_version=0/NULL)
// เมื่อ login ด้วย SHA2 สำเร็จ จะ auto-migrate เป็น bcrypt
app.post("/kpikorat/api/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน" });
  }
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.hospital_name, u.amphoe_name, u.role, u.hospcode, u.status, u.password_hash, u.password_version, u.dep_id,
              d.dept_name AS dep_name
       FROM users u LEFT JOIN departments d ON u.dep_id = d.id
       WHERE u.username = ?`,
      [username],
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง",
      });
    }

    const user = rows[0];
    let passwordValid = false;
    let needsMigration = false;

    if (+user.password_version === 1) {
      // bcrypt hash
      passwordValid = await bcrypt.compare(password, user.password_hash);
    } else {
      // Legacy SHA2 — เปรียบเทียบ in-process แทนการ query DB อีกครั้ง (ลด roundtrip)
      const sha2Hex = crypto.createHash("sha256").update(password).digest("hex");
      passwordValid = sha2Hex === String(user.password_hash || "").toLowerCase();
      needsMigration = passwordValid;
    }

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง",
      });
    }

    if (+user.status === 0) {
      return res.status(403).json({
        success: false,
        message: "บัญชีถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
      });
    }

    // สร้าง JWT Token
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      hospcode: user.hospcode,
      amphoe_name: user.amphoe_name,
      dep_id: user.dep_id,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // ส่งกลับ user info + token (ไม่ส่ง password_hash กลับ)
    const {
      status: _s,
      password_hash: _ph,
      password_version: _pv,
      ...userInfo
    } = user;
    res.json({ success: true, user: userInfo, token });

    // Auto-migrate SHA2 → bcrypt แบบ async (ทำหลังตอบ response) เพื่อไม่ block client
    // bcrypt.hash rounds=12 ใช้เวลา ~200ms — ถ้า await จะทำให้ login ช้าลงทุกครั้ง
    if (needsMigration) {
      bcrypt
        .hash(password, BCRYPT_ROUNDS)
        .then((bcryptHash) =>
          db.query(
            "UPDATE users SET password_hash = ?, password_version = 1 WHERE id = ?",
            [bcryptHash, user.id],
          ),
        )
        .catch((err) =>
          console.error("Auto-migrate to bcrypt failed for user", user.id, err.message),
        );
    }
  } catch (e) {
    console.error("Login Error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 2. API โครงสร้าง KPI (Logic เดียวกับ code.gs) --- [Cached 1 ชม.]
app.get("/kpikorat/api/kpi-structure", async (req, res) => {
  try {
    const sql = `
            SELECT
                i.id AS issue_id, i.name AS issue_name,
                m.id AS main_id, m.name AS main_name, m.target_label, m.dep_id AS main_dep_id,
                s.id AS sub_id, s.name AS sub_name,
                it.id AS item_id, it.name AS item_name, it.unit, it.target_value
            FROM kpi_issues i
            LEFT JOIN kpi_main_indicators m ON i.id = m.issue_id
            LEFT JOIN kpi_sub_activities s ON m.id = s.main_ind_id
            LEFT JOIN kpi_items it ON s.id = it.sub_activity_id
            ORDER BY i.id, m.id, s.id, it.id`;

    const [rows] = await db.query(sql);

    // แปลงข้อมูล Flat Data เป็น Nested Object (Issue -> Groups -> Subs -> Items)
    const issuesMap = new Map();
    for (const row of rows) {
      if (!issuesMap.has(row.issue_id)) {
        issuesMap.set(row.issue_id, {
          id: row.issue_id,
          title: row.issue_name,
          groups: [],
        });
      }
      const issue = issuesMap.get(row.issue_id);

      // Group (Main Indicator)
      let group = issue.groups.find((g) => g.mainId === row.main_id);
      if (!group && row.main_id) {
        group = {
          mainId: row.main_id,
          mainInd: row.main_name,
          mainTarget: row.target_label,
          mainDepId: row.main_dep_id,
          subs: [],
        };
        issue.groups.push(group);
      }

      // Sub Activity
      if (group) {
        let sub = group.subs.find((s) => s.subId === row.sub_id);
        if (!sub && row.sub_id) {
          sub = { subId: row.sub_id, name: row.sub_name, items: [] };
          group.subs.push(sub);
        }
        // Item
        if (sub && row.item_id) {
          sub.items.push({
            id: row.item_id,
            label: row.item_name,
            unit: row.unit,
            target: row.target_value,
          });
        }
      }
    }
    res.json({ success: true, data: Array.from(issuesMap.values()) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 3. API ดึงข้อมูลคะแนน (GetData) — ต้อง login ---
// Admin ทุกระดับสามารถระบุ targetUserId เพื่อดูข้อมูลของหน่วยบริการอื่นได้
app.get("/kpikorat/api/kpi-data", requireAuth, async (req, res) => {
  const ADMIN_ROLES = ["admin", "admin_cup", "admin_ssj", "super_admin"];
  const targetId = parseInt(req.query.userId);
  const isAdmin = ADMIN_ROLES.includes(req.user?.role);
  const userId =
    isAdmin && Number.isInteger(targetId) && targetId > 0
      ? targetId
      : req.user.id;
  const fiscalYear = validFiscalYear(req.query.fiscalYear);
  if (!fiscalYear)
    return res.status(400).json({ error: "ปีงบประมาณไม่ถูกต้อง" });
  try {
    const [rows] = await db.query(
      "SELECT kpi_id, report_month, kpi_value FROM kpi_records WHERE user_id = ? AND fiscal_year = ?",
      [userId, fiscalYear],
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 4. API บันทึกข้อมูล (SaveData) ---
// - ปกติ: ใช้ userId จาก JWT (user/admin_cup คีย์ของตัวเอง)
// - admin role (super_admin/admin_ssj/admin_cup): สามารถส่ง userId ใน body เพื่อบันทึกแทนได้
//   (เช่น เลือกหน่วยบริการ/อำเภอจากหน้า provincial-kpi)
app.post("/kpikorat/api/kpi-data/batch", async (req, res) => {
  const ADMIN_ROLES = ["admin", "admin_cup", "admin_ssj", "super_admin"];
  const isAdmin = ADMIN_ROLES.includes(req.user?.role);
  // amphoeMode: ถ้า true → ลบ/แทนที่ข้อมูลของทุก user ในอำเภอนั้น (ไม่ใช่แค่ user_id เดียว)
  const { fiscalYear, changes, userId: bodyUserId, amphoeMode } = req.body;

  // ถ้าเป็น admin และส่ง userId มาใน body → ใช้ตัวที่ส่งมา (บันทึกแทนหน่วยบริการ/อำเภอ)
  // มิฉะนั้นใช้ user_id ของผู้ login เอง
  let userId = req.user.id;
  if (isAdmin && bodyUserId && Number(bodyUserId) > 0) {
    userId = Number(bodyUserId);
  }

  const fy = validFiscalYear(fiscalYear);
  if (!fy) return res.status(400).json({ error: "ปีงบประมาณไม่ถูกต้อง" });
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: "ไม่มีข้อมูลที่จะบันทึก" });
  }
  if (changes.length > 1000) {
    return res
      .status(400)
      .json({ error: "บันทึกได้ไม่เกิน 1000 รายการต่อครั้ง" });
  }

  const conn = await pool.promise().getConnection();
  try {
    await conn.beginTransaction();

    // lookup hospcode + role + amphoe_name ของ target user จาก DB (สำคัญ — ห้ามใช้ JWT ของผู้ login)
    const [tgtRows] = await conn.query(
      "SELECT id, hospcode, role, amphoe_name FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (tgtRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: "ไม่พบ user ที่จะบันทึก" });
    }
    const tgtUser = tgtRows[0];
    // ห้ามบันทึกใน user ที่ไม่มี amphoe (super_admin/admin_ssj ที่ไม่ใช่ตัวแทนอำเภอ)
    if (!tgtUser.amphoe_name) {
      await conn.rollback();
      return res.status(400).json({
        error: "ไม่สามารถบันทึกใน user ที่ไม่มีอำเภอกำกับ — กรุณาเลือกหน่วยบริการหรืออำเภอที่ถูกต้อง",
      });
    }
    const userHospcode = tgtUser.hospcode || null;

    // แยกข้อมูลที่จะ Insert/Update ออกจากข้อมูลที่จะ Delete
    const toInsert = [];
    const toDeleteIds = [];
    console.log(`[saveBatch] target user_id=${userId}, changes:`, JSON.stringify(changes));

    for (let item of changes) {
      // ลบข้อมูล: value เป็น null/undefined/empty string
      if (item.value === null || item.value === undefined || item.value === "") {
        toDeleteIds.push({ kpi_id: item.kpi_id, month: item.month });
      } else {
        let yearAD = fy - 543;
        if (item.month >= 10) yearAD = fy - 544;
        toInsert.push([
          userId,
          userHospcode,
          fy,
          item.month,
          yearAD,
          item.kpi_id,
          item.value,
        ]);
      }
    }
    console.log(`[saveBatch] toInsert: ${toInsert.length}, toDelete: ${toDeleteIds.length}`);

    // 2. ทำ Bulk Insert (บันทึกหลาย Row พร้อมกัน)
    if (toInsert.length > 0) {
      // โหมดอำเภอ: ก่อน insert ลบข้อมูลเดิมของทุก user ในอำเภอ (เฉพาะ kpi_id+month ที่จะเขียนใหม่)
      // เพื่อไม่ให้ค่าซ้อนกัน (เพราะ provincial summary ใช้ SUM)
      if (isAdmin && amphoeMode && tgtUser.amphoe_name) {
        const [userRows] = await conn.query(
          `SELECT id FROM users WHERE amphoe_name = ? AND role = 'admin_cup'`,
          [tgtUser.amphoe_name]
        );
        const userIds = userRows.map((u) => u.id);
        if (userIds.length > 0) {
          const userPlaceholders = userIds.map(() => "?").join(",");
          const kpiMonthPairs = toInsert.map(() => "(?, ?)").join(",");
          const params = [
            ...userIds,
            fy,
            ...toInsert.flatMap((row) => [row[5], row[3]]), // [kpi_id, month] from row
          ];
          const [clearResult] = await conn.query(
            `DELETE FROM kpi_records
             WHERE user_id IN (${userPlaceholders})
               AND fiscal_year = ?
               AND (kpi_id, report_month) IN (${kpiMonthPairs})`,
            params
          );
          console.log(
            `[saveBatch] AMPHOE pre-clear (${tgtUser.amphoe_name}) affected: ${clearResult.affectedRows}`
          );
        }
      }

      const placeholders = toInsert
        .map(() => "(?, ?, ?, ?, ?, ?, ?)")
        .join(", ");
      const insertValues = toInsert.flat();

      await conn.query(
        `INSERT INTO kpi_records (user_id, hospcode, fiscal_year, report_month, report_year_ad, kpi_id, kpi_value)
                 VALUES ${placeholders}
                 ON DUPLICATE KEY UPDATE kpi_value = VALUES(kpi_value), hospcode = VALUES(hospcode), recorded_at = NOW()`,
        insertValues,
      );
    }

    // 3. ทำ Bulk Delete (ลบข้อมูลเก่า)
    if (toDeleteIds.length > 0) {
      if (isAdmin && amphoeMode && tgtUser.amphoe_name) {
        // โหมดอำเภอ: ลบข้อมูลของทุก user ในอำเภอนั้น (เพราะข้อมูลที่แสดงเป็น SUM ของหลาย user)
        const [userRows] = await conn.query(
          `SELECT id FROM users WHERE amphoe_name = ? AND role = 'admin_cup'`,
          [tgtUser.amphoe_name]
        );
        const userIds = userRows.map((u) => u.id);
        if (userIds.length > 0) {
          const userPlaceholders = userIds.map(() => "?").join(",");
          const kpiMonthPairs = toDeleteIds.map(() => "(?, ?)").join(",");
          const params = [
            ...userIds,
            fy,
            ...toDeleteIds.flatMap((d) => [d.kpi_id, d.month]),
          ];
          const [delResult] = await conn.query(
            `DELETE FROM kpi_records
             WHERE user_id IN (${userPlaceholders})
               AND fiscal_year = ?
               AND (kpi_id, report_month) IN (${kpiMonthPairs})`,
            params
          );
          console.log(
            `[saveBatch] AMPHOE DELETE (${tgtUser.amphoe_name}, ${userIds.length} users) affected: ${delResult.affectedRows}`
          );
        }
      } else {
        // โหมดปกติ: ลบเฉพาะ user_id ที่ระบุ
        const deletePlaceholders = toDeleteIds.map(() => "(?, ?, ?)").join(", ");
        const deleteValues = toDeleteIds.flatMap((d) => [
          userId,
          d.kpi_id,
          d.month,
        ]);
        const [delResult] = await conn.query(
          `DELETE FROM kpi_records WHERE (user_id, kpi_id, report_month) IN (${deletePlaceholders})`,
          deleteValues
        );
        console.log(`[saveBatch] DELETE affected rows: ${delResult.affectedRows}`);
      }
    }

    await conn.commit();
    // ล้าง cache dashboard/provincial เพราะข้อมูล KPI เปลี่ยน
    res.json({ success: true, count: changes.length });
  } catch (e) {
    await conn.rollback();
    console.error("Batch Save Error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  } finally {
    conn.release();
  }
});

// --- 5. API สำหรับ Admin: ดึงรายชื่ออำเภอ (เพื่อทำตัวกรอง) ---
app.get("/kpikorat/api/admin/amphoes", async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT DISTINCT amphoe_name FROM users WHERE role != "admin" ORDER BY amphoe_name',
    );
    res.json({ success: true, data: rows.map((r) => r.amphoe_name) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 6. API สำหรับ Admin: สรุปภาพรวมการบันทึก (Dashboard) ---
app.get("/kpikorat/api/admin/summary", async (req, res) => {
  const { fiscalYear } = req.query;
  try {
    // 1. หาจำนวน KPI ทั้งหมดที่มีในระบบก่อน (เพื่อเป็นตัวหาร)
    // สมมติว่านับตามจำนวน Items (ตัวชี้วัดย่อยสุด)
    const [totalRows] = await db.query(
      "SELECT COUNT(*) as total FROM kpi_items",
    );
    const totalKpis = totalRows[0].total || 0;

    // 2. ดึงข้อมูล User และนับว่าเขาบันทึกไปกี่ตัวแล้ว (COUNT DISTINCT kpi_id)
    const sql = `
            SELECT
                u.id,     -- เพิ่มตรงนี้
                u.hospcode,  -- เพิ่มตรงนี้ (รหัสหน่วยบริการ)
                u.username,          -- เพิ่มตรงนี้ (ชื่อผู้ใช้งาน)
                u.hospital_name,
                u.amphoe_name,
                COUNT(r.id) as record_count,
                COUNT(DISTINCT r.kpi_id) as recorded_count,
                MAX(r.recorded_at) as last_update
            FROM users u
            LEFT JOIN kpi_records r ON u.id = r.user_id AND r.fiscal_year = ?
            WHERE u.role != 'admin'
            GROUP BY u.id, u.hospcode, u.username, u.hospital_name, u.amphoe_name
            ORDER BY u.amphoe_name, u.hospital_name
        `;

    const [rows] = await db.query(sql, [fiscalYear]);

    // 3. คำนวณค่าเพิ่มเติมใน JS (บันทึกแล้ว, ยังไม่บันทึก, %)
    const processedRows = rows.map((row) => {
      const recorded = row.recorded_count || 0;
      const notRecorded = Math.max(0, totalKpis - recorded);
      const progress = totalKpis > 0 ? (recorded / totalKpis) * 100 : 0;

      return {
        ...row,
        total_kpis: totalKpis,
        recorded: recorded,
        not_recorded: notRecorded,
        progress: progress,
      };
    });

    res.json({ success: true, data: processedRows });
  } catch (e) {
    console.error(e);

    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 6b. API Monitor: รพ. / สสอ. พร้อม % ผลงานที่ผ่านเป้าหมาย ---
app.get("/kpikorat/api/admin/monitor", async (req, res) => {
  const { fiscalYear } = req.query;
  const fy = parseInt(fiscalYear) || 2569;
  try {
    const [totalRows] = await db.query("SELECT COUNT(*) as total FROM kpi_items");
    const totalKpis = totalRows[0].total || 0;

    // Derived table (ka): รวม target และ result รายตัวชี้วัด / รายหน่วยบริการ
    // จากนั้น outer query นับ:
    //   recorded_count = KPI ที่มีผลงานรายเดือนบันทึกแล้ว (monthly_count > 0)
    //   kpis_passed    = KPI ที่ผ่านเป้าหมาย (result >= target > 0)
    const sql = `
      SELECT
        u.id, u.hospcode, u.username, u.hospital_name, u.amphoe_name,
        COUNT(DISTINCT CASE WHEN ka.monthly_count > 0 THEN ka.kpi_id END) AS recorded_count,
        COUNT(DISTINCT CASE WHEN ka.target > 0 AND ka.result >= ka.target THEN ka.kpi_id END) AS kpis_passed,
        MAX(ka.last_rec) AS last_update
      FROM users u
      LEFT JOIN (
        SELECT
          user_id, kpi_id,
          MAX(CASE WHEN report_month = 0 THEN kpi_value ELSE 0 END) AS target,
          SUM(CASE WHEN report_month > 0 THEN kpi_value ELSE 0 END) AS result,
          COUNT(CASE WHEN report_month > 0 THEN 1 END)              AS monthly_count,
          MAX(CASE WHEN report_month > 0 THEN recorded_at END)       AS last_rec
        FROM kpi_records
        WHERE fiscal_year = ?
        GROUP BY user_id, kpi_id
      ) ka ON u.id = ka.user_id
      WHERE u.role = 'user'
        AND (
          u.hospital_name LIKE '%โรงพยาบาลส่งเสริมสุขภาพตำบล%'
          OR (u.hospital_name LIKE '%โรงพยาบาล%' AND u.hospital_name NOT LIKE '%โรงพยาบาลส่งเสริมสุขภาพตำบล%')
          OR u.hospital_name LIKE '%สำนักงานสาธารณสุขอำเภอ%'
          OR u.hospital_name LIKE '%สาธารณสุขอำเภอ%'
        )
      GROUP BY u.id, u.hospcode, u.username, u.hospital_name, u.amphoe_name
      ORDER BY u.amphoe_name, u.hospital_name
    `;
    const [rows] = await db.query(sql, [fy]);

    const data = rows.map((row) => {
      const recorded    = +(row.recorded_count || 0);
      const kpisPassed  = +(row.kpis_passed   || 0);
      const notRecorded = Math.max(0, totalKpis - recorded);
      // progress: สัดส่วน KPI ที่บันทึกแล้ว (สำหรับ progress bar)
      const progress     = totalKpis > 0 ? (recorded   / totalKpis) * 100 : 0;
      // passed_percent: สัดส่วน KPI ที่ผ่านเป้าหมาย (result >= target > 0)
      const passedPercent = totalKpis > 0 ? (kpisPassed / totalKpis) * 100 : 0;

      let unit_type = 'อื่นๆ';
      const n = (row.hospital_name || '').trim();
      if (n.includes('โรงพยาบาลส่งเสริมสุขภาพตำบล')) unit_type = 'รพ.สต.';
      else if (n.includes('โรงพยาบาล')) unit_type = 'รพ.';
      else if (n.includes('สำนักงานสาธารณสุขอำเภอ') || n.includes('สาธารณสุขอำเภอ')) unit_type = 'สสอ.';

      return {
        ...row,
        total_kpis: totalKpis,
        recorded,
        not_recorded: notRecorded,
        kpis_passed: kpisPassed,
        progress,
        passed_percent: passedPercent,
        unit_type,
        has_data: recorded > 0,
      };
    });

    res.json({ success: true, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- DEBUG: List all hospitals with their names ---
app.get("/kpikorat/api/admin/debug/hospitals", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, hospcode, hospital_name, amphoe_name
      FROM users WHERE role = 'user'
      ORDER BY amphoe_name, hospital_name
    `);
    // Group by type for visibility (match frontend pattern exactly)
    const grouped = {
      rphst: rows.filter(r => r.hospital_name?.includes('โรงพยาบาลส่งเสริมสุขภาพตำบล')),
      rph: rows.filter(r => r.hospital_name?.includes('โรงพยาบาล') && !r.hospital_name?.includes('โรงพยาบาลส่งเสริมสุขภาพตำบล')),
      ssao: rows.filter(r => r.hospital_name?.includes('สำนักงานสาธารณสุขอำเภอ') || r.hospital_name?.includes('สาธารณสุขอำเภอ')),
      other: rows.filter(r => !r.hospital_name?.includes('โรงพยาบาล') && !r.hospital_name?.includes('สำนักงานสาธารณสุขอำเภอ') && !r.hospital_name?.includes('สาธารณสุขอำเภอ'))
    };
    res.json({
      success: true,
      total: rows.length,
      grouped: {
        'รพ.สต. count': grouped.rphst.length,
        'รพ. count': grouped.rph.length,
        'สสอ. count': grouped.ssao.length,
        'อื่นๆ count': grouped.other.length
      },
      units: {
        rphst: grouped.rphst.map(r => ({ hospcode: r.hospcode, name: r.hospital_name, amphoe: r.amphoe_name })),
        rph: grouped.rph.map(r => ({ hospcode: r.hospcode, name: r.hospital_name, amphoe: r.amphoe_name })),
        ssao: grouped.ssao.map(r => ({ hospcode: r.hospcode, name: r.hospital_name, amphoe: r.amphoe_name })),
        other: grouped.other.map(r => ({ hospcode: r.hospcode, name: r.hospital_name, amphoe: r.amphoe_name }))
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- 6c. API Monitor Pivot: เป้าหมาย + ผลงานรายเดือน (multi-select, monthly breakdown) ---
app.get("/kpikorat/api/admin/monitor-pivot", async (req, res) => {
  const { fiscalYear, issueIds, itemIds, monthCount = 4 } = req.query;
  const fy = parseInt(fiscalYear) || 2569;
  const mCount = Math.min(Math.max(parseInt(monthCount) || 4, 1), 12);
  try {
    // 1. resolve KPI columns (multi-select issueIds หรือ multi-select itemIds)
    let itemSql = `
      SELECT it.id, it.name, it.unit, i.name as issue_name, m.name as main_name
      FROM kpi_items it
      JOIN kpi_sub_activities s ON it.sub_activity_id = s.id
      JOIN kpi_main_indicators m ON s.main_ind_id = m.id
      JOIN kpi_issues i ON m.issue_id = i.id WHERE 1=1
    `;
    const itemParams = [];
    const parsedItemIds = itemIds
      ? String(itemIds).split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x))
      : [];
    const parsedIssueIds = issueIds
      ? String(issueIds).split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x))
      : [];
    if (parsedItemIds.length > 0) {
      itemSql += ` AND it.id IN (${parsedItemIds.map(() => '?').join(',')})`;
      itemParams.push(...parsedItemIds);
    } else if (parsedIssueIds.length > 0) {
      itemSql += ` AND i.id IN (${parsedIssueIds.map(() => '?').join(',')})`;
      itemParams.push(...parsedIssueIds);
    }
    itemSql += ' ORDER BY i.id, m.id, s.id, it.id LIMIT 20';
    const [columns] = await db.query(itemSql, itemParams);
    if (!columns.length) return res.json({ success: true, columns: [], data: [], monthHeaders: [] });

    // 2. คำนวณ month list (เดือนปัจจุบัน ย้อนหลัง mCount เดือน)
    const now = new Date();
    const cal = now.getMonth() + 1;
    const currentFiscalMonth = cal >= 10 ? cal - 9 : cal + 3;
    const MNAMES = ['','ต.ค.','พ.ย.','ธ.ค.','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.'];
    const monthList = [];
    for (let i = 0; i < mCount; i++) {
      let fm = currentFiscalMonth - i;
      let fy2 = fy;
      if (fm <= 0) { fm += 12; fy2 -= 1; }
      monthList.push({ fiscalMonth: fm, fiscalYear: fy2, key: fy2 * 100 + fm });
    }
    const monthHeaders = monthList.map(({ fiscalMonth: fm, fiscalYear: y, key }) => ({
      fiscalMonth: fm, fiscalYear: y, key,
      label: `${MNAMES[fm]}${String(y).slice(-2)}`,
      isCurrent: fm === currentFiscalMonth && y === fy
    }));

    // 3. hospitals รพ.สต./รพ./สสอ.
    const [hospitals] = await db.query(`
      SELECT id, hospcode, username, hospital_name, amphoe_name
      FROM users WHERE role = 'user'
        AND (
          hospital_name LIKE '%โรงพยาบาลส่งเสริมสุขภาพตำบล%'
          OR (hospital_name LIKE '%โรงพยาบาล%' AND hospital_name NOT LIKE '%โรงพยาบาลส่งเสริมสุขภาพตำบล%')
          OR hospital_name LIKE '%สำนักงานสาธารณสุขอำเภอ%'
          OR hospital_name LIKE '%สาธารณสุขอำเภอ%'
        )
      ORDER BY amphoe_name, hospital_name
    `);

    // 4. query records
    const colIds = columns.map(c => +c.id);   // force number
    const colPH  = colIds.map(() => '?').join(',');
    const fySet  = [...new Set([fy, ...monthList.map(m => m.fiscalYear)])];
    const fyPH   = fySet.map(() => '?').join(',');

    // diagnostic: ตรวจว่า kpi_records มีข้อมูลใดบ้างสำหรับ kpi_ids+fy นี้
    // แสดง calendar_month และ fiscal_month เพื่อดูการ convert
    const [diagRows] = await db.query(`
      SELECT
        r.report_month as calendar_month,
        CASE
          WHEN r.report_month >= 10 THEN r.report_month - 9
          ELSE r.report_month + 3
        END as fiscal_month,
        r.fiscal_year,
        COUNT(*) as cnt
      FROM kpi_records r
      WHERE r.kpi_id IN (${colPH}) AND r.fiscal_year IN (${fyPH})
      GROUP BY r.fiscal_year, r.report_month
      ORDER BY r.fiscal_year, r.report_month
    `, [...colIds, ...fySet]);
    console.log('[pivot] kpiIds=%j fySet=%j diagRows=%j', colIds, fySet, diagRows);

    // ดึง records ทั้งหมดสำหรับ KPI+FY นี้
    // เป้าหมาย (report_month=0) เก็บเป็น 0 เสมอ
    // ผลงานรายเดือน (report_month>0) convert calendar → fiscal_month:
    //   calendar >= 10 (Oct-Dec) => fiscal = cal - 9  (Oct=1, Nov=2, Dec=3)
    //   calendar < 10  (Jan-Sep) => fiscal = cal + 3  (Jan=4, Feb=5, ..., Sep=12)
    const [kpiRows] = await db.query(`
      SELECT
        r.user_id,
        r.kpi_id,
        CASE
          WHEN r.report_month = 0 THEN 0
          WHEN r.report_month >= 10 THEN r.report_month - 9
          ELSE r.report_month + 3
        END + 0                 AS report_month,
        r.fiscal_year  + 0      AS fiscal_year,
        SUM(r.kpi_value)        AS value,
        MAX(r.recorded_at)      AS last_rec
      FROM kpi_records r
      WHERE r.kpi_id IN (${colPH})
        AND r.fiscal_year IN (${fyPH})
      GROUP BY r.user_id, r.kpi_id,
        CASE WHEN r.report_month = 0 THEN 0 WHEN r.report_month >= 10 THEN r.report_month - 9 ELSE r.report_month + 3 END,
        r.fiscal_year
    `, [...colIds, ...fySet]);

    console.log('[pivot] kpiRows count=%d sample=%j', kpiRows.length, kpiRows[0] || null);

    // 5. build kpiMap { userId: { kpiId: { target, months: {key: value} } } }
    // key = fy*100+month (number) — store ALL months (no validMonthKeys filter)
    // frontend uses pivotMonthHeaders to pick which months to display
    const kpiMap = {}, lastMap = {};
    kpiRows.forEach(r => {
      const uid    = +r.user_id;
      const kpiId  = +r.kpi_id;
      const rMonth = +r.report_month;   // `+ 0` in SQL ensures numeric, `+` in JS for safety
      const rFy    = +r.fiscal_year;

      if (!kpiMap[uid])        kpiMap[uid]        = {};
      if (!kpiMap[uid][kpiId]) kpiMap[uid][kpiId] = { target: 0, months: {} };
      const kd = kpiMap[uid][kpiId];

      if (rMonth === 0) {
        // target (month=0) — ใช้เฉพาะปีงบปัจจุบัน
        if (rFy === fy) kd.target = +(r.value || 0);
      } else if (rMonth >= 1 && rMonth <= 12) {
        // monthly result — เก็บทุกเดือนที่มี (frontend filter ด้วย pivotMonthHeaders)
        const mKey = rFy * 100 + rMonth;
        kd.months[mKey] = +(r.value || 0);
      }

      if (r.last_rec && (!lastMap[uid] || r.last_rec > lastMap[uid]))
        lastMap[uid] = r.last_rec;
    });

    // 6. assemble output
    const data = hospitals.map(h => {
      const kpis = kpiMap[h.id] || {};
      // has_data = มีผลงานรายเดือน (report_month > 0) อย่างน้อย 1 ตัวชี้วัด
      const hasData = colIds.some(id => kpis[id] && Object.keys(kpis[id].months).length > 0);
      let unit_type = 'อื่นๆ';
      const n = (h.hospital_name || '').trim();
      if (n.includes('โรงพยาบาลส่งเสริมสุขภาพตำบล')) unit_type = 'รพ.สต.';
      else if (n.includes('โรงพยาบาล')) unit_type = 'รพ.';
      else if (n.includes('สาธารณสุขอำเภอ')) unit_type = 'สสอ.';
      return { ...h, unit_type, kpis, has_data: hasData, last_update: lastMap[h.id] || null };
    });

    // debug summary (ลบออกได้หลังแก้บัก)
    const _debug = {
      colIds,
      fySet,
      monthKeys: monthList.map(m => m.key),
      kpiRowsTotal: kpiRows.length,
      diagRows,
      sampleKpiRow: kpiRows[0] || null,
    };
    console.log('[pivot] _debug=%j', _debug);

    res.json({ success: true, columns, data, monthHeaders, _debug });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 6d. API Monitor Monthly: เปรียบเทียบการบันทึกรายเดือน ---
app.get("/kpikorat/api/admin/monitor-monthly", async (req, res) => {
  const { fiscalYear, monthCount = 4 } = req.query;
  const fy = parseInt(fiscalYear) || 2569;
  const mCount = Math.min(Math.max(parseInt(monthCount) || 4, 2), 6);

  try {
    const [totalRows] = await db.query("SELECT COUNT(*) as total FROM kpi_items");
    const totalKpis = totalRows[0].total || 0;

    // คำนวณ fiscal month ปัจจุบัน (ต.ค.=1 … ก.ย.=12)
    const now = new Date();
    const cal = now.getMonth() + 1;
    const currentFiscalMonth = cal >= 10 ? cal - 9 : cal + 3;

    // สร้างรายการเดือนย้อนหลัง
    const monthList = [];
    for (let i = 0; i < mCount; i++) {
      let m = currentFiscalMonth - i;
      let y = fy;
      if (m <= 0) { m += 12; y -= 1; }
      monthList.push({ fiscalMonth: m, fiscalYear: y });
    }

    // ดึง hospitals รพ./สสอ.
    const [hospitals] = await db.query(`
      SELECT id, hospcode, username, hospital_name, amphoe_name
      FROM users WHERE role = 'user'
        AND (
          (hospital_name LIKE '%โรงพยาบาล%' AND hospital_name NOT LIKE '%โรงพยาบาลส่งเสริมสุขภาพตำบล%')
          OR hospital_name LIKE '%สาธารณสุขอำเภอ%'
        )
      ORDER BY amphoe_name, hospital_name
    `);

    // ดึง records ทุกเดือนในครั้งเดียว (grouped by user_id, fiscal_year, report_month)
    // รวมทั้งสอง fiscal year ที่อาจเกิดขึ้นเมื่อเดือนข้ามปี
    const fySet = [...new Set(monthList.map(m => m.fiscalYear))];
    const monthSet = monthList.map(m => m.fiscalMonth);
    const fyPlaceholders = fySet.map(() => '?').join(',');
    const mPlaceholders = monthSet.map(() => '?').join(',');

    const [records] = await db.query(`
      SELECT user_id, fiscal_year, report_month, COUNT(DISTINCT kpi_id) as recorded
      FROM kpi_records
      WHERE fiscal_year IN (${fyPlaceholders})
        AND report_month IN (${mPlaceholders})
        AND report_month > 0
      GROUP BY user_id, fiscal_year, report_month
    `, [...fySet, ...monthSet]);

    // สร้าง map: { "userId_fy_month": recorded }
    const recMap = {};
    records.forEach(r => { recMap[`${r.user_id}_${r.fiscal_year}_${r.report_month}`] = +(r.recorded || 0); });

    const MONTH_NAMES = ['','ต.ค.','พ.ย.','ธ.ค.','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.'];

    const data = hospitals.map(h => {
      let unit_type = 'อื่นๆ';
      const n = (h.hospital_name || '').trim();
      if (n.includes('โรงพยาบาลส่งเสริมสุขภาพตำบล')) unit_type = 'รพ.สต.';
      else if (n.includes('โรงพยาบาล')) unit_type = 'รพ.';
      else if (n.includes('สาธารณสุขอำเภอ')) unit_type = 'สสอ.';

      const months = monthList.map(({ fiscalMonth, fiscalYear: y }) => {
        const key = `${h.id}_${y}_${fiscalMonth}`;
        const recorded = recMap[key] || 0;
        return { fiscalMonth, fiscalYear: y, monthName: MONTH_NAMES[fiscalMonth], recorded, has_data: recorded > 0 };
      });

      const hasAnyCurrent = months[0]?.has_data || false;
      return { ...h, unit_type, months, has_data: hasAnyCurrent };
    });

    const monthHeaders = monthList.map(({ fiscalMonth, fiscalYear: y }) => ({
      fiscalMonth, fiscalYear: y,
      label: `${MONTH_NAMES[fiscalMonth]}${String(y).slice(-2)}`,
      isCurrent: fiscalMonth === currentFiscalMonth && y === fy
    }));

    res.json({ success: true, data, totalKpis, monthHeaders, currentFiscalMonth });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 7. API ตัวเลือกสำหรับตัวกรอง (Issues, Main Indicators, Items) ---
app.get("/kpikorat/api/admin/kpi-options", async (req, res) => {
  try {
    const [issues] = await db.query("SELECT id, name FROM kpi_issues ORDER BY id");
    const [mains] = await db.query(
      "SELECT m.id, m.name, m.issue_id, m.dep_id, d.dept_name AS dep_name FROM kpi_main_indicators m LEFT JOIN departments d ON m.dep_id = d.id ORDER BY m.id"
    );
    const [items] = await db.query(
      `SELECT it.id, it.name, it.sub_activity_id, s.main_ind_id
       FROM kpi_items it JOIN kpi_sub_activities s ON it.sub_activity_id = s.id ORDER BY it.id`
    );
    const [departments] = await db.query("SELECT id, dept_code, dept_name FROM departments WHERE is_active = 1 ORDER BY id");
    res.json({ success: true, issues, mains, items, departments });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 8. API รายงานละเอียด (Detailed Report) พร้อม Pagination ---
app.get("/kpikorat/api/admin/report", async (req, res) => {
  const fy = validFiscalYear(req.query.fiscalYear);
  const pPage = validPage(req.query.page);
  const pLimit = validLimit(req.query.limit);
  if (!fy) return res.status(400).json({ error: "ปีงบประมาณไม่ถูกต้อง" });
  const offset = (pPage - 1) * pLimit;
  const { amphoe, issueId, itemId } = req.query;

  try {
    let baseSql = `
            FROM kpi_records r
            JOIN users u ON r.user_id = u.id
            JOIN kpi_items it ON r.kpi_id = it.id
            JOIN kpi_sub_activities s ON it.sub_activity_id = s.id
            JOIN kpi_main_indicators m ON s.main_ind_id = m.id
            JOIN kpi_issues i ON m.issue_id = i.id
            WHERE r.fiscal_year = ? AND u.role = 'user'
        `;

    const params = [fy];

    // เติมเงื่อนไขตัวกรอง (Dynamic Where)
    if (amphoe && amphoe !== "ทั้งหมด") {
      baseSql += " AND u.amphoe_name = ?";
      params.push(amphoe);
    }
    if (issueId && issueId !== "all") {
      baseSql += " AND i.id = ?";
      params.push(issueId);
    }
    if (itemId && itemId !== "all") {
      baseSql += " AND it.id = ?";
      params.push(itemId);
    }

    // 1. หาจำนวนรายการทั้งหมดก่อน (เพื่อทำ Pagination)
    // Group by user_id และ kpi_id เพื่อให้นับเป็น 1 แถวต่อ 1 KPI
    const countSql = `SELECT COUNT(*) as total FROM (SELECT r.id ${baseSql} GROUP BY r.user_id, r.kpi_id) as t`;
    const [countRows] = await db.query(countSql, params);
    const totalItems = countRows[0].total;

    // 2. ดึงข้อมูลจริง (คำนวณเป้าหมายและผลงาน)
    const dataSql = `
            SELECT
                u.hospcode, u.hospital_name, u.amphoe_name,r.fiscal_year,
                i.name as issue_name,
                m.name as main_name,
                s.name as sub_name,
                it.name as item_name,
                it.unit,
                -- คำนวณเป้าหมาย (Month 0)
                MAX(CASE WHEN r.report_month = 0 THEN r.kpi_value ELSE 0 END) as target,
                -- คำนวณผลงาน (Month 1-12)
                SUM(CASE WHEN r.report_month > 0 THEN r.kpi_value ELSE 0 END) as result
            ${baseSql}
            GROUP BY r.user_id, r.kpi_id
            ORDER BY u.amphoe_name, u.hospital_name, i.id, it.id
            LIMIT ? OFFSET ?
        `;

    // params เดิม + limit, offset
    const [rows] = await db.query(dataSql, [...params, pLimit, offset]);

    res.json({ success: true, data: rows, total: totalItems });
  } catch (e) {
    console.error(e);

    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
// --- 9. API กราฟสรุปผลงานรายอำเภอ ---
app.get("/kpikorat/api/dashboard/district-stats", async (req, res) => {
  const { fiscalYear, kpiId } = req.query;
  try {
    let kpiFilter = "";
    const params = [fiscalYear, fiscalYear];

    // ถ้ามีการเลือก KPI ตัวเฉพาะ ให้กรองเพิ่ม
    if (kpiId && kpiId !== "all") {
      kpiFilter = "AND t.kpi_id = ?";
      params.push(kpiId);
    }

    const sql = `
            SELECT
                u.amphoe_name,
                -- คำนวณ % ความสำเร็จเฉลี่ยของอำเภอนั้น
                AVG(
                    CASE
                        WHEN t.target_value > 0 THEN (COALESCE(r.result_value, 0) / t.target_value) * 100
                        ELSE 0
                    END
                ) as avg_percent
            FROM users u
            -- Join 1: ดึงเป้าหมาย (Month 0)
            JOIN (
                SELECT user_id, kpi_id, kpi_value as target_value
                FROM kpi_records
                WHERE report_month = 0 AND fiscal_year = ?
            ) t ON u.id = t.user_id
            -- Join 2: ดึงผลงานรวม (Sum Month 1-12)
            LEFT JOIN (
                SELECT user_id, kpi_id, SUM(kpi_value) as result_value
                FROM kpi_records
                WHERE report_month > 0 AND fiscal_year = ?
                GROUP BY user_id, kpi_id
            ) r ON t.user_id = r.user_id AND t.kpi_id = r.kpi_id
            WHERE u.role != 'admin' ${kpiFilter}
            GROUP BY u.amphoe_name
            ORDER BY avg_percent DESC -- เรียงจากมากไปน้อย
        `;

    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    console.error(e);

    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// -------------------------------------------------------------------------
// ✅ เพิ่ม API ใหม่: สำหรับ Dashboard สรุปผลงาน แยกตามประเด็น
// -------------------------------------------------------------------------
app.get("/kpikorat/api/districts", async (req, res) => {
  try {
    const sql = `SELECT DISTINCT amphoe_name FROM users WHERE amphoe_name IS NOT NULL ORDER BY amphoe_name`;
    const [rows] = await db.execute(sql);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get Districts Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// --- 10. API ภาพรวมระดับจังหวัด: ผลรวม KPI ทุกหน่วยบริการ ---
app.get("/kpikorat/api/provincial/summary", async (req, res) => {
  const fy = validFiscalYear(req.query.fiscalYear) || 2569;
  const amphoe = req.query.amphoe || null;
  try {
    // รวมข้อมูลจากทุก user ที่มีการบันทึกผลงาน (รวม super_admin, admin_ssj, admin_cup, user, admin legacy)
    let sql = `SELECT r.kpi_id, r.report_month, SUM(r.kpi_value) AS total_value
       FROM kpi_records r
       JOIN users u ON r.user_id = u.id
       WHERE r.fiscal_year = ?`;
    const params = [fy];
    if (amphoe) {
      sql += " AND u.amphoe_name = ?";
      params.push(amphoe);
    }
    sql += " GROUP BY r.kpi_id, r.report_month";
    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- Departments API ---
app.get("/kpikorat/api/admin/departments", async (_req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, dept_code, dept_name FROM departments WHERE is_active = 1 ORDER BY id",
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 11. API รายชื่อหน่วยบริการทั้งหมด (สำหรับ Admin) ---
// GET: หา admin_cup user (สำนักงานสาธารณสุขอำเภอ) ของอำเภอที่ระบุ
app.get("/kpikorat/api/admin/cup-user", async (req, res) => {
  const amphoe = typeof req.query.amphoe === "string" ? req.query.amphoe.trim() : "";
  if (!amphoe) return res.status(400).json({ error: "amphoe required" });
  try {
    const [rows] = await db.query(
      `SELECT id, username, hospital_name, amphoe_name, role
       FROM users
       WHERE TRIM(amphoe_name) = ? AND role = 'admin_cup'
       ORDER BY id LIMIT 1`,
      [amphoe]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `ไม่พบ admin_cup ของอำเภอ ${amphoe}` });
    }
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

app.get("/kpikorat/api/admin/hospitals", async (req, res) => {
  try {
    // ดึงทุก user ที่ไม่ใช่ admin ระดับสูง — ไม่กรอง status, ไม่บังคับ amphoe_name
    // (รวม รพ., รพ.สต., สสอ. ที่อาจมี/ไม่มี amphoe_name หรือ status)
    const sql = `SELECT id, hospital_name, amphoe_name, hospcode, username, role, COALESCE(status,1) AS status
       FROM users
       WHERE role NOT IN ('super_admin','admin_ssj')
       ORDER BY amphoe_name, hospital_name`;
    const [rows] = await db.query(sql);
    // Debug log
    const roleCount = {};
    rows.forEach(r => { roleCount[r.role || 'null'] = (roleCount[r.role || 'null'] || 0) + 1; });
    console.log(`[admin/hospitals] total: ${rows.length} by role:`, roleCount);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 12. Download Excel Template สำหรับตัวชี้วัดที่เลือก ---
app.get("/kpikorat/api/admin/import-template", async (req, res) => {
  const { kpi_id, byear, hospcode } = req.query;
  if (!kpi_id)
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุ kpi_id" });

  try {
    // ดึงชื่อตัวชี้วัด
    const [[kpiItem]] = await db.query(
      `SELECT id, name FROM kpi_items WHERE id = ?`,
      [kpi_id],
    );
    if (!kpiItem)
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบตัวชี้วัด" });

    // ดึงรายชื่อหน่วยบริการ (ถ้า hospcode ระบุมา → เฉพาะ hospcode นั้น)
    let hospitalQuery = `SELECT id, hospcode, hospital_name, amphoe_name FROM users WHERE role != 'admin'`;
    const hospitalParams = [];
    if (hospcode) {
      hospitalQuery += ` AND hospcode = ?`;
      hospitalParams.push(hospcode);
    } else {
      hospitalQuery += ` ORDER BY amphoe_name, hospital_name`;
    }
    const [hospitals] = await db.query(hospitalQuery, hospitalParams);

    const fiscalYear = parseInt(byear) || 2569;
    const adYear = fiscalYear - 543;

    // ดึงข้อมูลเดิมจาก kpi_records สำหรับ kpi_id + byear นี้
    const hospIds = hospitals.map((h) => h.id);
    let existingMap = {};
    if (hospIds.length > 0) {
      const [existingRows] = await db.query(
        `SELECT u.hospcode, r.report_month, r.kpi_value
         FROM kpi_records r
         JOIN users u ON r.user_id = u.id
         WHERE r.kpi_id = ? AND r.fiscal_year = ? AND u.hospcode IN (${hospIds.map(() => "?").join(",")})`,
        [kpi_id, fiscalYear, ...hospIds],
      );
      for (const row of existingRows) {
        const key = `${row.hospcode}_${row.report_month}`;
        existingMap[key] = row.kpi_value;
      }
    }

    // สร้าง Workbook
    const wb = XLSX.utils.book_new();

    // Sheet 1: Template กรอกข้อมูล
    const headers = [
      "hospcode",
      "hospname",
      "ampurname",
      "kpi_indicators",
      "byear",
      "m_10",
      "m_11",
      "m_12",
      "m_01",
      "m_02",
      "m_03",
      "m_04",
      "m_05",
      "m_06",
      "m_07",
      "m_08",
      "m_09",
    ];
    const descriptions = [
      "รหัสหน่วยบริการ\n(ห้ามแก้ไข)",
      "ชื่อหน่วยบริการ\n(ห้ามแก้ไข)",
      "อำเภอ\n(ห้ามแก้ไข)",
      "ชื่อตัวชี้วัด\n(ห้ามแก้ไข)",
      `ปีงบประมาณ\n(ห้ามแก้ไข)`,
      `ต.ค.${adYear - 1}`,
      `พ.ย.${adYear - 1}`,
      `ธ.ค.${adYear - 1}`,
      `ม.ค.${adYear}`,
      `ก.พ.${adYear}`,
      `มี.ค.${adYear}`,
      `เม.ย.${adYear}`,
      `พ.ค.${adYear}`,
      `มิ.ย.${adYear}`,
      `ก.ค.${adYear}`,
      `ส.ค.${adYear}`,
      `ก.ย.${adYear}`,
    ];

    const monthKeys = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const dataRows = hospitals.map((h) => [
      h.hospcode,
      h.hospital_name,
      h.amphoe_name,
      kpiItem.name,
      fiscalYear,
      ...monthKeys.map((m) => existingMap[`${h.hospcode}_${m}`] ?? 0),
    ]);

    const wsData = [headers, descriptions, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // กำหนดความกว้าง column
    ws["!cols"] = [
      { wch: 12 },
      { wch: 40 },
      { wch: 18 },
      { wch: 50 },
      { wch: 12 },
      ...Array(12).fill({ wch: 10 }),
    ];
    // Freeze แถว 2 บน (header + description)
    ws["!freeze"] = { xSplit: 0, ySplit: 2 };

    XLSX.utils.book_append_sheet(wb, ws, "ข้อมูล");

    // Sheet 2: คำอธิบาย
    const infoWs = XLSX.utils.aoa_to_sheet([
      ["คำอธิบายการกรอกข้อมูล"],
      [""],
      ["ตัวชี้วัด:", `KPI ${kpiItem.id}: ${kpiItem.name}`],
      ["ปีงบประมาณ:", fiscalYear],
      [""],
      ["คอลัมน์", "คำอธิบาย", "หมายเหตุ"],
      [
        "hospcode",
        "รหัสหน่วยบริการ 5 หลัก",
        "ห้ามแก้ไข - ใช้สำหรับ match ข้อมูล",
      ],
      ["hospname", "ชื่อหน่วยบริการ", "ห้ามแก้ไข - ข้อมูลอ้างอิง"],
      ["ampurname", "ชื่ออำเภอ", "ห้ามแก้ไข - ข้อมูลอ้างอิง"],
      ["kpi_indicators", "ชื่อตัวชี้วัด", "ห้ามแก้ไข - ใช้สำหรับ match ข้อมูล"],
      ["byear", "ปีงบประมาณ (พ.ศ.)", `ห้ามแก้ไข - ต้องเป็น ${fiscalYear}`],
      ["m_10", `ผลงาน ต.ค.${adYear - 1}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_11", `ผลงาน พ.ย.${adYear - 1}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_12", `ผลงาน ธ.ค.${adYear - 1}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_01", `ผลงาน ม.ค.${adYear}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_02", `ผลงาน ก.พ.${adYear}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_03", `ผลงาน มี.ค.${adYear}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_04", `ผลงาน เม.ย.${adYear}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_05", `ผลงาน พ.ค.${adYear}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_06", `ผลงาน มิ.ย.${adYear}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_07", `ผลงาน ก.ค.${adYear}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_08", `ผลงาน ส.ค.${adYear}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      ["m_09", `ผลงาน ก.ย.${adYear}`, "กรอกเป็นตัวเลข (จำนวนเต็ม)"],
      [""],
      ["หมายเหตุ:", "กรอกเฉพาะคอลัมน์ m_10 ถึง m_09 เท่านั้น"],
      ["", "ระบบจะ match ข้อมูลด้วย hospcode เท่านั้น"],
      ["", "ถ้าเดือนไหนไม่มีข้อมูลให้ใส่ 0"],
    ]);
    infoWs["!cols"] = [{ wch: 18 }, { wch: 40 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, infoWs, "คำอธิบาย");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `template_kpi${kpi_id}_${fiscalYear}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(buf);
  } catch (e) {
    console.error("Template error:", e);
    console.error(e);

    res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 13. Upload Excel/CSV → import เข้า kpi_records ---
// Helper: parse Excel buffer → validated data rows
async function parseImportFile(buffer, filterHospcode) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: 0 });
  if (rows.length < 3)
    throw new Error(
      "ไฟล์ไม่มีข้อมูล (ต้องมีอย่างน้อย 1 แถวข้อมูลหลังจาก header 2 แถว)",
    );

  const headerRow = rows[0];
  const colIndex = {};
  const required = [
    "hospcode",
    "kpi_indicators",
    "byear",
    "m_10",
    "m_11",
    "m_12",
    "m_01",
    "m_02",
    "m_03",
    "m_04",
    "m_05",
    "m_06",
    "m_07",
    "m_08",
    "m_09",
  ];
  for (const col of required) {
    const idx = headerRow.indexOf(col);
    if (idx === -1) throw new Error(`ไม่พบคอลัมน์ "${col}" ใน header`);
    colIndex[col] = idx;
  }

  const months = [
    { col: "m_10", month: 10 },
    { col: "m_11", month: 11 },
    { col: "m_12", month: 12 },
    { col: "m_01", month: 1 },
    { col: "m_02", month: 2 },
    { col: "m_03", month: 3 },
    { col: "m_04", month: 4 },
    { col: "m_05", month: 5 },
    { col: "m_06", month: 6 },
    { col: "m_07", month: 7 },
    { col: "m_08", month: 8 },
    { col: "m_09", month: 9 },
  ];

  const [kpiItems] = await db.query("SELECT id, name FROM kpi_items");
  const kpiMap = {};
  for (const ki of kpiItems) kpiMap[ki.name.trim()] = ki.id;

  const [users] = await db.query(
    "SELECT id, hospcode FROM users WHERE role != 'admin'",
  );
  const userMap = {};
  for (const u of users) userMap[u.hospcode] = u.id;

  const validRows = [];
  const skipReasons = [];

  for (const row of rows.slice(2)) {
    const hospcode = String(row[colIndex["hospcode"]] ?? "")
      .trim()
      .padStart(5, "0");
    if (!hospcode || hospcode === "00000") continue;
    // กรองเฉพาะ hospcode ของ user ที่ส่งมา (ถ้าไม่ใช่ admin)
    if (filterHospcode && hospcode !== filterHospcode) continue;

    const kpiName = String(row[colIndex["kpi_indicators"]] ?? "").trim();
    const byear = parseInt(row[colIndex["byear"]]) || 0;
    const userId = userMap[hospcode];
    const kpiId = kpiMap[kpiName];

    if (!userId) {
      skipReasons.push(`hospcode ${hospcode} ไม่พบในระบบ`);
      continue;
    }
    if (!kpiId) {
      skipReasons.push(`ตัวชี้วัด "${kpiName}" ไม่พบในระบบ`);
      continue;
    }
    if (!byear) {
      skipReasons.push(`ปีงบประมาณไม่ถูกต้อง (hospcode=${hospcode})`);
      continue;
    }

    const adYear = byear - 543;
    const monthVals = {};
    for (const { col, month } of months) {
      monthVals[month] = Math.round(parseFloat(row[colIndex[col]]) || 0);
    }
    validRows.push({
      hospcode,
      kpiName,
      byear,
      userId,
      kpiId,
      adYear,
      monthVals,
    });
  }

  return { validRows, skipReasons, months };
}

// Helper: batch query current DB values for valid rows
async function fetchCurrentValues(validRows) {
  if (validRows.length === 0) return {};
  const hospcodes = [...new Set(validRows.map((r) => r.hospcode))];
  const byears = [...new Set(validRows.map((r) => r.byear))];
  const hPlc = hospcodes.map(() => "?").join(",");
  const yPlc = byears.map(() => "?").join(",");
  const [recs] = await db.query(
    `SELECT u.hospcode, r.kpi_id, r.report_month, r.fiscal_year, r.kpi_value
     FROM kpi_records r JOIN users u ON r.user_id = u.id
     WHERE u.hospcode IN (${hPlc}) AND r.fiscal_year IN (${yPlc})`,
    [...hospcodes, ...byears],
  );
  const curMap = {};
  for (const rec of recs) {
    curMap[
      `${rec.hospcode}_${rec.kpi_id}_${rec.report_month}_${rec.fiscal_year}`
    ] = rec.kpi_value;
  }
  return curMap;
}

// --- 13. Preview: เปรียบเทียบก่อน import (ไม่เขียน DB) ---
app.post(
  "/kpikorat/api/admin/import-excel-preview",
  upload.single("file"),
  async (req, res) => {
    if (!req.file)
      return res.status(400).json({ success: false, message: "กรุณาแนบไฟล์" });
    // ถ้าไม่ใช่ admin ให้บังคับ filterHospcode = hospcode ของ user จาก JWT เสมอ (ป้องกันนำเข้าข้อมูล user อื่น)
    const filterHospcode =
      req.user?.role === "admin"
        ? req.body.filterHospcode || null
        : req.user?.hospcode || null;

    try {
      const { validRows, skipReasons, months } = await parseImportFile(
        req.file.buffer,
        filterHospcode,
      );
      if (validRows.length === 0) {
        return res.json({
          success: true,
          summary: {
            increased: 0,
            decreased: 0,
            unchanged: 0,
            new_record: 0,
            skipped: skipReasons.length,
          },
          skip_reasons: skipReasons.slice(0, 10),
        });
      }

      const curMap = await fetchCurrentValues(validRows);
      let increased = 0,
        decreased = 0,
        unchanged = 0,
        new_record = 0;

      for (const row of validRows) {
        for (const { month } of months) {
          const newVal = row.monthVals[month];
          const key = `${row.hospcode}_${row.kpiId}_${month}_${row.byear}`;
          const curVal = curMap[key];
          if (curVal === undefined || curVal === null) {
            if (newVal > 0) new_record++;
            else unchanged++;
          } else if (newVal > curVal) {
            increased++;
          } else if (newVal < curVal) {
            decreased++;
          } else {
            unchanged++;
          }
        }
      }

      res.json({
        success: true,
        summary: {
          increased,
          decreased,
          unchanged,
          new_record,
          skipped: skipReasons.length,
        },
        total_data_rows: validRows.length,
        skip_reasons: skipReasons.slice(0, 10),
      });
    } catch (e) {
      res.status(400).json({ success: false, message: e.message });
    }
  },
);

// --- 13b. Execute: import Excel → kpi_records (เฉพาะที่เปลี่ยนแปลง) ---
app.post(
  "/kpikorat/api/admin/import-excel",
  upload.single("file"),
  async (req, res) => {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "กรุณาแนบไฟล์ Excel หรือ CSV" });
    // บังคับ hospcode จาก JWT สำหรับ non-admin
    const filterHospcode =
      req.user?.role === "admin"
        ? req.body.filterHospcode || null
        : req.user?.hospcode || null;

    try {
      const { validRows, skipReasons, months } = await parseImportFile(
        req.file.buffer,
        filterHospcode,
      );
      if (validRows.length === 0) {
        return res.json({
          success: true,
          imported: 0,
          updated: 0,
          skipped: skipReasons.length,
          total_rows: 0,
          skip_reasons: skipReasons.slice(0, 10),
        });
      }

      const curMap = await fetchCurrentValues(validRows);
      let imported = 0,
        updated = 0,
        unchanged_skip = 0;

      const insertSql = `
      INSERT INTO kpi_records (user_id, hospcode, fiscal_year, report_month, report_year_ad, kpi_id, kpi_value)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE kpi_value = VALUES(kpi_value), recorded_at = NOW()
    `;

      for (const row of validRows) {
        for (const { month } of months) {
          const newVal = row.monthVals[month];
          const key = `${row.hospcode}_${row.kpiId}_${month}_${row.byear}`;
          const curVal = curMap[key];
          // ข้ามถ้าค่าเท่าเดิม (และมีอยู่แล้ว)
          if (curVal !== undefined && curVal === newVal) {
            unchanged_skip++;
            continue;
          }

          const yearAd = month >= 10 ? row.adYear - 1 : row.adYear;
          const [result] = await db.execute(insertSql, [
            row.userId,
            row.hospcode,
            row.byear,
            month,
            yearAd,
            row.kpiId,
            newVal,
          ]);
          if (result.affectedRows === 2) updated++;
          else imported++;
        }
      }

      writeLog(
        req,
        "IMPORT",
        "kpi_records",
        null,
        `นำเข้า ${imported} ใหม่ ${updated} อัพเดต`,
      );
      res.json({
        success: true,
        imported,
        updated,
        skipped: skipReasons.length,
        unchanged_skip,
        total_rows: validRows.length,
        skip_reasons: skipReasons.slice(0, 10),
      });
    } catch (e) {
      console.error("Import Excel error:", e);
      res.status(400).json({ success: false, message: e.message });
    }
  },
);

// --- 14. Preview: สถิติข้อมูลใน kpi_records ที่จะ export ออกไป ---
app.get("/kpikorat/api/admin/export-preview", async (req, res) => {
  try {
    // สถิติแยกตามปีงบ: กี่หน่วยบริการ, กี่ kpi มีข้อมูล
    // รวมทุก user ที่มี amphoe_name (ตัด super_admin/admin_ssj)
    const [stats] = await db.query(`
      SELECT
        r.fiscal_year AS byear,
        COUNT(DISTINCT r.kpi_id)   AS kpis_with_data,
        COUNT(DISTINCT r.user_id)  AS total_hosps,
        COUNT(*)                   AS total_records
      FROM kpi_records r
      JOIN users u ON r.user_id = u.id
      WHERE u.role NOT IN ('super_admin','admin_ssj')
        AND u.amphoe_name IS NOT NULL AND u.amphoe_name <> ''
      GROUP BY r.fiscal_year
      ORDER BY r.fiscal_year DESC
    `);

    // ตรวจสอบว่าตาราง export ทั้ง 31 ตาราง มีอยู่ใน DB กี่ตาราง
    const [existingTables] = await db.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME LIKE 's_kpi_report_korathealth_%'
      ORDER BY TABLE_NAME
    `);
    const tableNames = existingTables.map((t) => t.TABLE_NAME);

    res.json({ success: true, data: stats, existing_tables: tableNames });
  } catch (e) {
    console.error(e);

    res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- Preview Detail: รายละเอียดของแต่ละ KPI ที่จะ export ในปีงบที่ระบุ ---
app.get("/kpikorat/api/admin/export-preview-detail", async (req, res) => {
  const byear = parseInt(req.query.byear);
  if (!byear) return res.status(400).json({ success: false, error: "กรุณาระบุปีงบ" });
  try {
    // ดึง KPI items ทั้งหมด พร้อมจำนวน records ต่อ KPI สำหรับปีงบนั้น
    const [items] = await db.query(
      `SELECT
         it.id, it.name,
         COALESCE(stats.record_count, 0) AS record_count,
         COALESCE(stats.hosp_count, 0)   AS hosp_count,
         COALESCE(stats.last_update, NULL) AS last_update
       FROM kpi_items it
       LEFT JOIN (
         SELECT r.kpi_id,
                COUNT(*) AS record_count,
                COUNT(DISTINCT r.user_id) AS hosp_count,
                MAX(r.recorded_at) AS last_update
         FROM kpi_records r
         JOIN users u ON r.user_id = u.id
         WHERE r.fiscal_year = ?
           AND u.role NOT IN ('super_admin','admin_ssj')
           AND u.hospcode IS NOT NULL AND u.hospcode <> ''
         GROUP BY r.kpi_id
       ) stats ON it.id = stats.kpi_id
       ORDER BY it.id`,
      [byear]
    );

    // ดึงรายชื่อตาราง s_kpi_report_korathealth_* ที่มีอยู่ใน DB
    const [existingTables] = await db.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME LIKE 's_kpi_report_korathealth_%'`
    );
    const existingSet = new Set(existingTables.map((t) => t.TABLE_NAME));

    // ตรวจจำนวน rows ที่มีอยู่แล้วในตารางปลายทาง (สำหรับปีงบนี้)
    const result = [];
    for (const item of items) {
      const tableName = getKorathealthTable(item.id);
      const tableExists = existingSet.has(tableName);
      let existingRows = 0;
      if (tableExists) {
        try {
          const [r] = await db.query(
            `SELECT COUNT(*) AS cnt FROM \`${tableName}\` WHERE byear = ?`,
            [byear]
          );
          existingRows = r[0]?.cnt || 0;
        } catch (_) { existingRows = 0; }
      }
      result.push({
        kpi_id: item.id,
        kpi_name: item.name,
        target_table: tableName,
        table_exists: tableExists,
        record_count: item.record_count,
        hosp_count: item.hosp_count,
        last_update: item.last_update,
        existing_rows: existingRows,
        ready: tableExists && item.record_count > 0,
      });
    }

    res.json({ success: true, byear, data: result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 13. Execute: export kpi_records → s_kpi_report_korathealth_1..31 (pivot เดือน) ---
app.post("/kpikorat/api/admin/export-korathealth", async (req, res) => {
  const { byear } = req.body;
  if (!byear)
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุปีงบประมาณ (byear)" });

  let exported_rows = 0,
    tables_updated = 0;
  const errors = [];

  try {
    // ดึงชื่อตัวชี้วัดทั้งหมด 31 ข้อ
    const [kpiItems] = await db.query(
      "SELECT id, name FROM kpi_items ORDER BY id",
    );
    if (kpiItems.length === 0) {
      return res.json({
        success: true,
        exported_rows: 0,
        tables_updated: 0,
        message: "ไม่พบข้อมูล kpi_items",
      });
    }

    // SELECT ข้อมูลที่จะ export (เฉพาะหน่วยบริการที่มี records จริง — INNER JOIN)
    // result = ค่าของเดือนล่าสุดที่มีข้อมูล (COALESCE chain)
    // target = month=0 ของหน่วยนั้นๆ
    const selectSql = `
      SELECT
        u.hospcode,
        u.hospital_name                                                        AS hospname,
        u.amphoe_name                                                          AS ampurname,
        ?                                                                      AS kpi_indicators,
        ?                                                                      AS byear,
        COALESCE(MAX(CASE WHEN r.report_month = 10 THEN r.kpi_value END), 0)  AS m_10,
        COALESCE(MAX(CASE WHEN r.report_month = 11 THEN r.kpi_value END), 0)  AS m_11,
        COALESCE(MAX(CASE WHEN r.report_month = 12 THEN r.kpi_value END), 0)  AS m_12,
        COALESCE(MAX(CASE WHEN r.report_month = 1  THEN r.kpi_value END), 0)  AS m_01,
        COALESCE(MAX(CASE WHEN r.report_month = 2  THEN r.kpi_value END), 0)  AS m_02,
        COALESCE(MAX(CASE WHEN r.report_month = 3  THEN r.kpi_value END), 0)  AS m_03,
        COALESCE(MAX(CASE WHEN r.report_month = 4  THEN r.kpi_value END), 0)  AS m_04,
        COALESCE(MAX(CASE WHEN r.report_month = 5  THEN r.kpi_value END), 0)  AS m_05,
        COALESCE(MAX(CASE WHEN r.report_month = 6  THEN r.kpi_value END), 0)  AS m_06,
        COALESCE(MAX(CASE WHEN r.report_month = 7  THEN r.kpi_value END), 0)  AS m_07,
        COALESCE(MAX(CASE WHEN r.report_month = 8  THEN r.kpi_value END), 0)  AS m_08,
        COALESCE(MAX(CASE WHEN r.report_month = 9  THEN r.kpi_value END), 0)  AS m_09,
        COALESCE(
          MAX(CASE WHEN r.report_month = 9  THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 8  THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 7  THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 6  THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 5  THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 4  THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 3  THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 2  THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 1  THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 12 THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 11 THEN r.kpi_value END),
          MAX(CASE WHEN r.report_month = 10 THEN r.kpi_value END),
          0
        )                                                                      AS result,
        COALESCE(MAX(CASE WHEN r.report_month = 0 THEN r.kpi_value END), 0)   AS target,
        MAX(r.recorded_at)                                                     AS last_update
      FROM users u
      LEFT JOIN kpi_records r ON r.user_id = u.id AND r.kpi_id = ? AND r.fiscal_year = ?
      WHERE u.role NOT IN ('super_admin','admin_ssj')
        AND u.hospcode IS NOT NULL AND u.hospcode <> ''
      GROUP BY u.hospcode, u.hospital_name, u.amphoe_name
    `;

    for (const { id: kpi_id, name: kpiName } of kpiItems) {
      const tableName = getKorathealthTable(kpi_id);
      try {
        const [chk] = await db.query(
          `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [tableName],
        );
        if (chk.length === 0) {
          errors.push(`ไม่พบตาราง ${tableName}`);
          continue;
        }

        // 1. ลบของเก่าก่อน
        await db.execute(`DELETE FROM \`${tableName}\` WHERE byear = ?`, [byear]);

        // 2. Bulk INSERT ... SELECT (1 query เดียว — เร็วมาก)
        const [insRes] = await db.execute(
          `INSERT INTO \`${tableName}\`
            (hospcode, hospname, ampurname, kpi_indicators, byear,
             m_10, m_11, m_12, m_01, m_02, m_03, m_04, m_05, m_06, m_07, m_08, m_09,
             result, target)
           SELECT
             u.hospcode, u.hospital_name, u.amphoe_name, ?, ?,
             COALESCE(MAX(CASE WHEN r.report_month=10 THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=11 THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=12 THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=1  THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=2  THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=3  THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=4  THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=5  THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=6  THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=7  THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=8  THEN r.kpi_value END),0),
             COALESCE(MAX(CASE WHEN r.report_month=9  THEN r.kpi_value END),0),
             COALESCE(
               MAX(CASE WHEN r.report_month=9 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=8 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=7 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=6 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=5 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=4 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=3 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=2 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=1 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=12 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=11 THEN r.kpi_value END),
               MAX(CASE WHEN r.report_month=10 THEN r.kpi_value END),
               0
             ),
             COALESCE(MAX(CASE WHEN r.report_month=0 THEN r.kpi_value END),0)
           FROM users u
           LEFT JOIN kpi_records r ON r.user_id=u.id AND r.kpi_id=? AND r.fiscal_year=?
           WHERE u.role NOT IN ('super_admin','admin_ssj')
             AND u.hospcode IS NOT NULL AND u.hospcode <> ''
           GROUP BY u.hospcode, u.hospital_name, u.amphoe_name`,
          [kpiName, byear, kpi_id, byear]
        );
        const updated = insRes.affectedRows || 0;
        exported_rows += updated;
        tables_updated++;
      } catch (tableErr) {
        errors.push(`${tableName}: ${tableErr.message}`);
      }
    }

    writeLog(
      req,
      "EXPORT",
      "kpi_records",
      null,
      `ส่งออกปี ${byear} ${tables_updated} ตาราง`,
    );
    res.json({
      success: true,
      exported_rows,
      tables_updated,
      byear,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    console.error("Export error:", e);
    console.error(e);

    res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ============================================================
// REMOTE SYNC: ส่งข้อมูล s_kpi_report_korathealth_1..31 → MySQL ปลายทาง
// ============================================================

// Helper: ดึง config ปัจจุบัน
async function getRemoteSyncConfig() {
  const [rows] = await db.query(
    "SELECT * FROM remote_sync_config WHERE name = 'default' LIMIT 1"
  );
  return rows[0] || null;
}

// Helper: สร้าง connection ไปยัง remote DB (decrypt password ก่อนใช้)
async function createRemoteConnection(cfg) {
  const conn = await mysqlPromise.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.username,
    password: decryptSecret(cfg.password_enc),
    database: cfg.database_name,
    connectTimeout: 10000,
  });
  return conn;
}

// Helper: ทำการ sync จริง (reusable สำหรับ manual + scheduled)
// kpiIds: array ของ kpi_id ที่จะ sync (ถ้าว่าง = ทุก 31 ตาราง)
async function performRemoteSync(byear, triggerType = "manual", userId = null, kpiIds = null) {
  const cfg = await getRemoteSyncConfig();
  if (!cfg) throw new Error("ไม่พบ config การ sync");
  if (!cfg.host || !cfg.username || !cfg.database_name) {
    throw new Error("กรุณาตั้งค่า config (host/user/db) ก่อน");
  }

  // เริ่มประวัติ
  const [hist] = await db.query(
    "INSERT INTO remote_sync_history (config_id, byear, trigger_type, status, triggered_by) VALUES (?, ?, ?, 'running', ?)",
    [cfg.id, byear, triggerType, userId]
  );
  const historyId = hist.insertId;

  let tablesSynced = 0;
  let rowsSynced = 0;
  const errors = [];
  let remoteConn;

  try {
    // เปิด connection ปลายทาง
    remoteConn = await createRemoteConnection(cfg);

    // กำหนดรายการ kpi ที่จะ sync (ถ้า kpiIds ระบุ → ใช้เฉพาะนั้น, มิฉะนั้น 1..31)
    const targetKpiIds = Array.isArray(kpiIds) && kpiIds.length > 0
      ? kpiIds.map((n) => parseInt(n)).filter((n) => n >= 1 && n <= 31)
      : Array.from({ length: 31 }, (_, i) => i + 1);

    // วนเฉพาะตารางที่เลือก
    for (const kpiId of targetKpiIds) {
      const tableName = getKorathealthTable(kpiId);
      try {
        // 1. ตรวจ local มีตาราง?
        const [localChk] = await db.query(
          `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [tableName]
        );
        if (localChk.length === 0) continue;

        // 2. ตรวจ remote มีตาราง?
        const [remoteChk] = await remoteConn.query(
          `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
          [cfg.database_name, tableName]
        );
        if (remoteChk.length === 0) {
          errors.push(`${tableName}: ไม่พบที่ปลายทาง`);
          continue;
        }

        // 3. SELECT จาก local (กรอง byear ถ้าระบุ)
        const localSql = byear
          ? `SELECT * FROM \`${tableName}\` WHERE byear = ?`
          : `SELECT * FROM \`${tableName}\``;
        const [localRows] = await db.query(localSql, byear ? [byear] : []);
        if (localRows.length === 0) continue;

        // 4. ดึง hospcode + byear ที่จะ sync จาก local
        const localHospcodes = [...new Set(localRows.map((r) => r.hospcode).filter(Boolean))];
        const localByears = [...new Set(localRows.map((r) => r.byear).filter(Boolean))];

        // 5. ลบ rows เก่าใน remote ที่ตรงกับ (hospcode, byear)
        let deleted = 0;
        if (localHospcodes.length > 0 && localByears.length > 0) {
          const hospPlaceholders = localHospcodes.map(() => "?").join(",");
          const byearPlaceholders = localByears.map(() => "?").join(",");
          const [delRes] = await remoteConn.query(
            `DELETE FROM \`${tableName}\`
             WHERE hospcode IN (${hospPlaceholders})
               AND byear IN (${byearPlaceholders})`,
            [...localHospcodes, ...localByears]
          );
          deleted = delRes.affectedRows || 0;
        }

        // 6. Bulk INSERT (1 query สำหรับ all rows ของตารางนี้)
        let inserted = 0;
        if (localRows.length > 0) {
          const cols = Object.keys(localRows[0]).filter((k) => k !== "id" && k !== "updated_at");
          const colNames = cols.map((c) => `\`${c}\``).join(",");
          const valuesPlaceholder = `(${cols.map(() => "?").join(",")})`;
          const allPlaceholders = localRows.map(() => valuesPlaceholder).join(",");
          const allValues = localRows.flatMap((row) => cols.map((c) => row[c]));
          try {
            const [insRes] = await remoteConn.query(
              `INSERT INTO \`${tableName}\` (${colNames}) VALUES ${allPlaceholders}`,
              allValues
            );
            inserted = insRes.affectedRows || 0;
          } catch (e) {
            errors.push(`${tableName} bulk insert: ${e.message}`);
          }
        }
        console.log(`[sync] ${tableName}: deleted_old=${deleted}, inserted=${inserted}`);
        rowsSynced += inserted;
        tablesSynced++;

        // 6. เคลียร์ local rows ที่ sync สำเร็จแล้ว
        if (inserted + updated > 0) {
          try {
            const delSql = byear
              ? `DELETE FROM \`${tableName}\` WHERE byear = ?`
              : `DELETE FROM \`${tableName}\``;
            await db.query(delSql, byear ? [byear] : []);
            console.log(`[sync] ${tableName}: cleared local rows after sync`);
          } catch (delErr) {
            errors.push(`${tableName} clear local: ${delErr.message}`);
          }
        }
      } catch (tErr) {
        errors.push(`${tableName}: ${tErr.message}`);
      }
    }

    // อัปเดตประวัติ
    const status = errors.length === 0 ? "success" : tablesSynced > 0 ? "partial" : "failed";
    await db.query(
      `UPDATE remote_sync_history
       SET status=?, tables_synced=?, rows_synced=?, error_count=?, message=?, finished_at=NOW()
       WHERE id=?`,
      [status, tablesSynced, rowsSynced, errors.length, errors.slice(0, 20).join("\n") || null, historyId]
    );
    // อัปเดต config last_sync
    await db.query(
      `UPDATE remote_sync_config SET last_sync_at=NOW(), last_status=?, last_message=? WHERE id=?`,
      [status, errors.length ? `${errors.length} ข้อผิดพลาด` : "สำเร็จ", cfg.id]
    );

    return { success: true, status, tablesSynced, rowsSynced, errors, historyId };
  } catch (e) {
    await db.query(
      `UPDATE remote_sync_history SET status='failed', message=?, finished_at=NOW() WHERE id=?`,
      [e.message, historyId]
    );
    await db.query(
      `UPDATE remote_sync_config SET last_sync_at=NOW(), last_status='failed', last_message=? WHERE id=?`,
      [e.message, cfg.id]
    );
    throw e;
  } finally {
    if (remoteConn) try { await remoteConn.end(); } catch (_) {}
  }
}

// POST: สร้างตาราง s_kpi_report_korathealth_1..31 ใน local + populate ข้อมูลทุกปีงบที่มี
app.post("/kpikorat/api/admin/export-tables/create", async (_req, res) => {
  try {
    const ddl = (n) => `
      CREATE TABLE IF NOT EXISTS \`s_kpi_report_korathealth_${n}\` (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        hospcode        VARCHAR(10) NOT NULL,
        hospname        VARCHAR(255) DEFAULT NULL,
        ampurname       VARCHAR(100) DEFAULT NULL,
        kpi_indicators  TEXT DEFAULT NULL,
        byear           INT NOT NULL,
        m_10 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_11 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_12 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_01 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_02 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_03 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_04 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_05 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_06 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_07 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_08 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_09 DECIMAL(15,2) NOT NULL DEFAULT 0,
        result          DECIMAL(15,2) NOT NULL DEFAULT 0,
        target          DECIMAL(15,2) NOT NULL DEFAULT 0,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_hospcode_byear (hospcode, byear),
        KEY idx_byear (byear)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;
    let created = 0;
    let populated = 0;
    const errors = [];

    // 1. สร้างตารางทั้ง 31 ตาราง
    for (let i = 1; i <= 31; i++) {
      try {
        await db.query(ddl(i));
        created++;
      } catch (e) {
        errors.push(`s_kpi_report_korathealth_${i}: ${e.message}`);
      }
    }

    // 2. ดึงรายชื่อ KPI items + ปีงบที่มี records
    const [kpiItems] = await db.query("SELECT id, name FROM kpi_items ORDER BY id");
    const [byears] = await db.query(
      "SELECT DISTINCT fiscal_year AS byear FROM kpi_records ORDER BY fiscal_year"
    );

    // 3. Populate ทุกตาราง × ทุกปีงบ ด้วย INSERT ... SELECT (bulk, 1 query ต่อ table+year)
    for (const { id: kpi_id, name: kpiName } of kpiItems) {
      const tableName = getKorathealthTable(kpi_id);
      for (const { byear } of byears) {
        try {
          // ลบของเก่าก่อน
          await db.query(`DELETE FROM \`${tableName}\` WHERE byear = ?`, [byear]);
          // INSERT ... SELECT แบบ bulk (1 query)
          const [insRes] = await db.query(
            `INSERT INTO \`${tableName}\`
              (hospcode, hospname, ampurname, kpi_indicators, byear,
               m_10, m_11, m_12, m_01, m_02, m_03, m_04, m_05, m_06, m_07, m_08, m_09,
               result, target)
             SELECT
               u.hospcode, u.hospital_name, u.amphoe_name, ?, ?,
               COALESCE(MAX(CASE WHEN r.report_month=10 THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=11 THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=12 THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=1  THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=2  THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=3  THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=4  THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=5  THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=6  THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=7  THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=8  THEN r.kpi_value END),0),
               COALESCE(MAX(CASE WHEN r.report_month=9  THEN r.kpi_value END),0),
               COALESCE(
                 MAX(CASE WHEN r.report_month=9 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=8 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=7 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=6 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=5 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=4 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=3 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=2 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=1 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=12 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=11 THEN r.kpi_value END),
                 MAX(CASE WHEN r.report_month=10 THEN r.kpi_value END),
                 0
               ),
               COALESCE(MAX(CASE WHEN r.report_month=0 THEN r.kpi_value END),0)
             FROM users u
             LEFT JOIN kpi_records r ON r.user_id=u.id AND r.kpi_id=? AND r.fiscal_year=?
             WHERE u.role NOT IN ('super_admin','admin_ssj')
               AND u.hospcode IS NOT NULL AND u.hospcode <> ''
             GROUP BY u.hospcode, u.hospital_name, u.amphoe_name`,
            [kpiName, byear, kpi_id, byear]
          );
          populated += insRes.affectedRows || 0;
        } catch (e) {
          errors.push(`${tableName} byear=${byear}: ${e.message}`);
        }
      }
    }

    res.json({ success: true, created, populated, errors });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST: สร้างตารางบน remote
app.post("/kpikorat/api/admin/export-tables/create-remote", async (_req, res) => {
  let remoteConn;
  try {
    const cfg = await getRemoteSyncConfig();
    if (!cfg || !cfg.host) {
      return res.status(400).json({ success: false, error: "กรุณาตั้งค่า config sync ก่อน" });
    }
    remoteConn = await createRemoteConnection(cfg);
    const ddl = (n) => `
      CREATE TABLE IF NOT EXISTS \`s_kpi_report_korathealth_${n}\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        hospcode VARCHAR(10) NOT NULL,
        hospname VARCHAR(255) DEFAULT NULL,
        ampurname VARCHAR(100) DEFAULT NULL,
        kpi_indicators TEXT DEFAULT NULL,
        byear INT NOT NULL,
        m_10 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_11 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_12 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_01 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_02 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_03 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_04 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_05 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_06 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_07 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_08 DECIMAL(15,2) NOT NULL DEFAULT 0,
        m_09 DECIMAL(15,2) NOT NULL DEFAULT 0,
        result DECIMAL(15,2) NOT NULL DEFAULT 0,
        target DECIMAL(15,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_hospcode_byear (hospcode, byear),
        KEY idx_byear (byear)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;
    let created = 0;
    const errors = [];
    for (let i = 1; i <= 31; i++) {
      try {
        await remoteConn.query(ddl(i));
        created++;
      } catch (e) {
        errors.push(`s_kpi_report_korathealth_${i}: ${e.message}`);
      }
    }
    res.json({ success: true, created, errors });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    if (remoteConn) try { await remoteConn.end(); } catch (_) {}
  }
});

// GET: เปรียบเทียบ local กับ remote (ตรวจสอบก่อน sync)
app.get("/kpikorat/api/admin/remote-sync/compare", async (_req, res) => {
  let remoteConn;
  try {
    const cfg = await getRemoteSyncConfig();
    if (!cfg || !cfg.host) {
      return res.status(400).json({ success: false, error: "กรุณาตั้งค่า config ก่อน" });
    }
    remoteConn = await createRemoteConnection(cfg);

    const result = {
      remote_db: cfg.database_name,
      tables: [],
      summary: {
        total_tables: 31,
        local_tables: 0,
        remote_tables: 0,
        matching_tables: 0,
        local_rows: 0,
        remote_rows: 0,
        new_rows: 0,
        existing_rows: 0,
      },
    };

    for (let kpiId = 1; kpiId <= 31; kpiId++) {
      const tableName = getKorathealthTable(kpiId);
      const item = {
        kpi_id: kpiId,
        table_name: tableName,
        local_exists: false,
        remote_exists: false,
        local_rows: 0,
        remote_rows: 0,
        new_rows: 0,        // อยู่ใน local แต่ไม่มี hospcode นั้นใน remote → จะถูกเพิ่ม
        existing_rows: 0,   // อยู่ทั้ง local + remote (hospcode ตรง) → จะถูกข้าม
      };

      // ตรวจ local
      const [localChk] = await db.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
      );
      item.local_exists = localChk.length > 0;

      // ตรวจ remote
      const [remoteChk] = await remoteConn.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [cfg.database_name, tableName]
      );
      item.remote_exists = remoteChk.length > 0;

      if (item.local_exists) result.summary.local_tables++;
      if (item.remote_exists) result.summary.remote_tables++;

      if (item.local_exists && item.remote_exists) {
        result.summary.matching_tables++;

        // นับ rows local
        const [localCount] = await db.query(`SELECT COUNT(*) AS c FROM \`${tableName}\``);
        item.local_rows = localCount[0].c;
        result.summary.local_rows += item.local_rows;

        // นับ rows remote
        const [remoteCount] = await remoteConn.query(`SELECT COUNT(*) AS c FROM \`${tableName}\``);
        item.remote_rows = remoteCount[0].c;
        result.summary.remote_rows += item.remote_rows;

        // หา hospcode ที่อยู่ใน local
        const [localHosps] = await db.query(
          `SELECT DISTINCT hospcode FROM \`${tableName}\` WHERE hospcode IS NOT NULL AND hospcode <> ''`
        );
        const localSet = new Set(localHosps.map((r) => r.hospcode));

        if (localSet.size > 0) {
          // หา hospcode ที่มีอยู่แล้วใน remote
          const placeholders = [...localSet].map(() => "?").join(",");
          const [remoteHosps] = await remoteConn.query(
            `SELECT DISTINCT hospcode FROM \`${tableName}\` WHERE hospcode IN (${placeholders})`,
            [...localSet]
          );
          const remoteSet = new Set(remoteHosps.map((r) => r.hospcode));

          item.existing_rows = remoteSet.size;
          item.new_rows = localSet.size - remoteSet.size;
          result.summary.existing_rows += item.existing_rows;
          result.summary.new_rows += item.new_rows;
        }
      }

      result.tables.push(item);
    }

    res.json({ success: true, data: result });
  } catch (e) {
    console.error("Compare error:", e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    if (remoteConn) try { await remoteConn.end(); } catch (_) {}
  }
});

// GET: ดึง config ปัจจุบัน
app.get("/kpikorat/api/admin/remote-sync/config", async (_req, res) => {
  try {
    const cfg = await getRemoteSyncConfig();
    if (!cfg) return res.json({ success: true, data: null });
    res.json({
      success: true,
      data: {
        id: cfg.id,
        name: cfg.name,
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password_enc: cfg.password_enc ? "***" : "",
        database_name: cfg.database_name,
        enabled: !!cfg.enabled,
        schedule_type: cfg.schedule_type || "interval",
        interval_value: cfg.interval_value || 30,
        interval_unit: cfg.interval_unit || "minute",
        daily_time: cfg.daily_time || "12:00",
        start_date: cfg.start_date,
        end_date: cfg.end_date,
        last_sync_at: cfg.last_sync_at,
        last_status: cfg.last_status,
        last_message: cfg.last_message,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// PUT: บันทึก config
app.put("/kpikorat/api/admin/remote-sync/config", async (req, res) => {
  try {
    const {
      host, port, username, password_enc, database_name, enabled,
      schedule_type, interval_value, interval_unit, daily_time, start_date, end_date,
    } = req.body;
    if (!host || !username || !database_name) {
      return res.status(400).json({ success: false, error: "กรุณากรอก host/user/db" });
    }
    const cfg = await getRemoteSyncConfig();
    // ถ้า password_enc ว่าง หรือเป็น "***" → ใช้ค่าเดิม
    // มิฉะนั้น encrypt password ใหม่ก่อนเก็บ
    const encryptedPw = password_enc && password_enc !== "***"
      ? encryptSecret(password_enc)
      : cfg?.password_enc || "";
    if (cfg) {
      await db.query(
        `UPDATE remote_sync_config
         SET host=?, port=?, username=?, password_enc=?, database_name=?, enabled=?,
             schedule_type=?, interval_value=?, interval_unit=?, daily_time=?, start_date=?, end_date=?
         WHERE id=?`,
        [
          host, port || 3306, username, encryptedPw, database_name, enabled ? 1 : 0,
          schedule_type || "interval", parseInt(interval_value) || 30, interval_unit || "minute",
          daily_time || "12:00", start_date || null, end_date || null, cfg.id,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO remote_sync_config
         (name, host, port, username, password_enc, database_name, enabled,
          schedule_type, interval_value, interval_unit, daily_time, start_date, end_date)
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          host, port || 3306, username, encryptedPw, database_name, enabled ? 1 : 0,
          schedule_type || "interval", parseInt(interval_value) || 30, interval_unit || "minute",
          daily_time || "12:00", start_date || null, end_date || null,
        ]
      );
    }
    rescheduleSyncJob();
    writeLog(req, "UPDATE", "remote_sync_config", null, "อัปเดต config sync");
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// POST: ทดสอบ connection
app.post("/kpikorat/api/admin/remote-sync/test", async (req, res) => {
  try {
    const { host, port, username, password_enc, database_name } = req.body;
    const cfg = await getRemoteSyncConfig();
    // ถ้า user ส่ง password ใหม่ → ใช้ตามนั้น (plaintext)
    // ถ้าว่าง/*** → ใช้ค่าเดิมจาก DB (decrypt)
    const pwToUse = password_enc && password_enc !== "***"
      ? password_enc
      : decryptSecret(cfg?.password_enc || "");
    const conn = await mysqlPromise.createConnection({
      host, port: port || 3306, user: username, password: pwToUse,
      database: database_name, connectTimeout: 8000,
    });
    await conn.query("SELECT 1");
    await conn.end();
    res.json({ success: true, message: "เชื่อมต่อสำเร็จ" });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST: trigger manual sync
app.post("/kpikorat/api/admin/remote-sync/run", async (req, res) => {
  const byear = req.body?.byear ? parseInt(req.body.byear) : null;
  const kpiIds = Array.isArray(req.body?.kpiIds) ? req.body.kpiIds : null;
  try {
    const result = await performRemoteSync(byear, "manual", req.user?.id || null, kpiIds);
    writeLog(req, "EXPORT", "remote_sync", null,
      `Sync ปี ${byear || 'ทั้งหมด'} (${kpiIds ? kpiIds.length + ' ตาราง' : 'all'}): ${result.tablesSynced} ตาราง ${result.rowsSynced} แถว`);
    res.json(result);
  } catch (e) {
    console.error("Sync error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET: ประวัติ sync
app.get("/kpikorat/api/admin/remote-sync/history", async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT h.*, u.username AS triggered_by_name
       FROM remote_sync_history h
       LEFT JOIN users u ON h.triggered_by = u.id
       ORDER BY h.started_at DESC LIMIT 50`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ─── Scheduler ────────────────────────────────────────
// ใช้ setInterval ง่ายๆ — ตรวจทุก 1 นาทีว่าถึงเวลา cron หรือยัง
let syncJobTimer = null;
let lastScheduledRun = null;

function rescheduleSyncJob() {
  // restart timer (ตรวจทุกนาที)
  if (syncJobTimer) clearInterval(syncJobTimer);
  syncJobTimer = setInterval(checkAndRunScheduled, 60 * 1000);
  console.log("[sync scheduler] reset (check every 1 min)");
}

async function checkAndRunScheduled() {
  try {
    const cfg = await getRemoteSyncConfig();
    if (!cfg || !cfg.enabled) return;

    const now = new Date();

    // ตรวจช่วงวันที่เริ่ม-สิ้นสุด
    if (cfg.start_date) {
      const start = new Date(cfg.start_date);
      start.setHours(0, 0, 0, 0);
      if (now < start) return;
    }
    if (cfg.end_date) {
      const end = new Date(cfg.end_date);
      end.setHours(23, 59, 59, 999);
      if (now > end) return;
    }

    let shouldRun = false;

    if (cfg.schedule_type === "daily" && cfg.daily_time) {
      // รูปแบบ "ทุกวันเวลา HH:mm"
      const [h, m] = cfg.daily_time.split(":").map(Number);
      if (now.getHours() === h && now.getMinutes() === m) shouldRun = true;
    } else if (cfg.schedule_type === "interval" || !cfg.schedule_type) {
      // รูปแบบ "ทุก N นาที" หรือ "ทุก N ชั่วโมง"
      const value = parseInt(cfg.interval_value) || 30;
      const unit = cfg.interval_unit || "minute";
      if (unit === "minute") {
        if (value > 0 && now.getMinutes() % value === 0) shouldRun = true;
      } else if (unit === "hour") {
        if (value > 0 && now.getMinutes() === 0 && now.getHours() % value === 0) shouldRun = true;
      }
    }

    if (!shouldRun) return;

    // ป้องกันรันซ้ำในนาทีเดียวกัน
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (lastScheduledRun === key) return;
    lastScheduledRun = key;

    console.log(`[sync scheduler] running scheduled sync (${cfg.schedule_type})...`);
    await performRemoteSync(null, "scheduled", null);
    console.log("[sync scheduler] done");
  } catch (e) {
    console.error("[sync scheduler] error:", e.message);
  }
}

// เริ่ม scheduler ตอน boot
rescheduleSyncJob();

// --- AGENDA REPORT: Provincial 1+11 KPI Report ---
app.get("/kpikorat/api/provincial/agenda-report", async (req, res) => {
  const { fiscalYear } = req.query;
  const fy = parseInt(fiscalYear) || 2569;
  const ALL_MONTHS = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const Q2 = [1, 2, 3];
  const Q3 = [4, 5, 6];
  const Q4 = [7, 8, 9];

  try {
    // Query เดียว (สอดคล้องกับ /provincial/summary) — รวมทุก report_month รวมถึง month=0 (target)
    const [records] = await db.query(
      `SELECT r.kpi_id, r.report_month, SUM(r.kpi_value) AS total_value, u.amphoe_name
       FROM kpi_records r
       JOIN users u ON r.user_id = u.id
       WHERE r.fiscal_year = ? AND u.role = 'user'
       GROUP BY r.kpi_id, r.report_month, u.amphoe_name`,
      [fy],
    );

    // ดึง kpi_main_records ระดับอำเภอ (ผลงานรายเดือน, ไม่รวม month=0)
    const [mainRecords] = await db.query(
      `SELECT main_ind_id, report_month, SUM(kpi_value) AS total_value, amphoe_name
       FROM kpi_main_records
       WHERE fiscal_year = ? AND amphoe_name IS NOT NULL AND report_month != 0
       GROUP BY main_ind_id, report_month, amphoe_name`,
      [fy],
    );
    // mainTotalMap[main_ind_id][month] = ยอดรวมรายอำเภอ
    const mainTotalMap = {};
    const mainAmphoeMap = {};
    for (const row of mainRecords) {
      const id = row.main_ind_id,
        m = row.report_month,
        v = parseFloat(row.total_value || 0);
      if (!mainTotalMap[id]) mainTotalMap[id] = {};
      mainTotalMap[id][m] = (mainTotalMap[id][m] || 0) + v;
      if (!mainAmphoeMap[id]) mainAmphoeMap[id] = {};
      if (!mainAmphoeMap[id][row.amphoe_name])
        mainAmphoeMap[id][row.amphoe_name] = {};
      mainAmphoeMap[id][row.amphoe_name][m] =
        (mainAmphoeMap[id][row.amphoe_name][m] || 0) + v;
    }

    // เป้าหมายระดับจังหวัด = ค่าล่าสุดที่บันทึก (recorded_at สูงสุด) ของแต่ละ main_ind_id ที่ amphoe_name IS NULL
    // ไม่ fallback ไปที่ผลรวมรายอำเภอ — ถ้าไม่มี row NULL-amphoe → เป้าหมาย = 0
    const [provinceLatestRows] = await db.query(
      `SELECT r1.main_ind_id, r1.kpi_value
       FROM kpi_main_records r1
       INNER JOIN (
         SELECT main_ind_id, MAX(recorded_at) AS max_at
         FROM kpi_main_records
         WHERE fiscal_year = ? AND amphoe_name IS NULL
         GROUP BY main_ind_id
       ) r2 ON r1.main_ind_id = r2.main_ind_id AND r1.recorded_at = r2.max_at
       WHERE r1.fiscal_year = ? AND r1.amphoe_name IS NULL`,
      [fy, fy],
    );
    const mainProvinceTargetMap = {};
    for (const r of provinceLatestRows) {
      mainProvinceTargetMap[r.main_ind_id] = parseFloat(r.kpi_value || 0);
    }

    // totalMap[kpi_id][month] = ยอดรวมทั้งจังหวัด (month=0 คือ target, month อื่น คือ ผลงาน)
    const totalMap = {};
    // amphoeMap[kpi_id][amphoe_name][month] = ผลงานรายอำเภอรายเดือน (ไม่รวม month=0)
    const amphoeMap = {};
    for (const row of records) {
      const id = row.kpi_id,
        m = row.report_month,
        v = parseFloat(row.total_value || 0);
      if (!totalMap[id]) totalMap[id] = {};
      totalMap[id][m] = (totalMap[id][m] || 0) + v;
      if (m !== 0) {
        // amphoeMap สำหรับนับอำเภอ ไม่รวม month=0
        if (!amphoeMap[id]) amphoeMap[id] = {};
        if (!amphoeMap[id][row.amphoe_name])
          amphoeMap[id][row.amphoe_name] = {};
        amphoeMap[id][row.amphoe_name][m] =
          (amphoeMap[id][row.amphoe_name][m] || 0) + v;
      }
    }

    // ดึงเป้าหมาย (month=0) รวมทุก hospcode — เหมือน dataMap[kpi_id_0] ใน provincial-kpi
    const getTargetSum = (kpiIds) =>
      kpiIds.reduce((s, id) => s + (totalMap[id]?.[0] || 0), 0);

    // ดึงผลรวมผลงานตามเดือนที่ระบุ
    const getSum = (kpiIds, months) =>
      kpiIds.reduce(
        (s, id) =>
          s + months.reduce((ms, m) => ms + (totalMap[id]?.[m] || 0), 0),
        0,
      );

    // ดึงผลงานเดือนล่าสุดที่มีข้อมูล (ไม่สะสมข้ามเดือน)
    const getLatestValue = (kpiIds, months) =>
      kpiIds.reduce((s, id) => {
        for (let i = months.length - 1; i >= 0; i--) {
          const v = totalMap[id]?.[months[i]] || 0;
          if (v > 0) return s + v;
        }
        return s;
      }, 0);

    // Helper: ดึงข้อมูล main indicator และเชื่อม override data
    // เป้าหมาย: ดึงจากระดับจังหวัด (kpi_main_records NULL-amphoe) เท่านั้น
    // ผลงาน: ใช้ sum รายอำเภอจาก main_records ถ้ามี ไม่งั้นใช้ค่า resultVal ที่ส่งเข้ามา
    const buildIndWithData = (
      no,
      name,
      note,
      targetVal,
      resultVal,
      unit,
      mainIndId,
    ) => {
      let t = mainIndId ? getMainIndTarget(mainIndId) : targetVal;
      let r = resultVal;
      if (mainIndId && hasMainIndData(mainIndId)) {
        const mr = getMainIndLatest(mainIndId, ALL_MONTHS);
        if (mr > 0) r = mr;
      }
      const pct = t > 0 ? Math.round((r / t) * 10000) / 100 : 0;
      return {
        no,
        name,
        note,
        target: t,
        result: r,
        percentage: pct,
        unit,
        main_ind_id: mainIndId || null,
        has_main_data: mainIndId ? hasMainIndData(mainIndId) : false,
      };
    };

    const buildInd = (no, name, note, targetVal, resultVal, unit) => {
      const pct =
        targetVal > 0 ? Math.round((resultVal / targetVal) * 10000) / 100 : 0;
      return {
        no,
        name,
        note,
        target: targetVal,
        result: resultVal,
        percentage: pct,
        unit,
      };
    };

    // District count helpers
    const countDistrictsWithData = (kpiId) => {
      if (!amphoeMap[kpiId]) return { count: 0, names: [] };
      const names = Object.entries(amphoeMap[kpiId])
        .filter(([, months]) => ALL_MONTHS.some((m) => (months[m] || 0) > 0))
        .map(([name]) => name)
        .sort();
      return { count: names.length, names };
    };

    // Main Indicator helpers
    // เป้าหมาย: ใช้ค่าล่าสุดที่บันทึก (recorded_at สูงสุด) ของระดับจังหวัด (amphoe_name IS NULL) เท่านั้น
    // ไม่ fallback ไปที่ผลรวมรายอำเภอ
    const getMainIndTarget = (mainIndId) => mainProvinceTargetMap[mainIndId] || 0;

    // ผลงานสะสมรวมจังหวัด: รวมค่าเดือนล่าสุดของแต่ละอำเภอ
    const getMainIndLatest = (mainIndId, months) => {
      if (!mainAmphoeMap[mainIndId]) {
        // fallback: ถ้าไม่มีข้อมูลรายอำเภอ ดึงจาก mainTotalMap (เดือนล่าสุด)
        for (let i = months.length - 1; i >= 0; i--) {
          const v = mainTotalMap[mainIndId]?.[months[i]] || 0;
          if (v > 0) return v;
        }
        return 0;
      }
      // รวม latest ของแต่ละอำเภอเป็นภาพรวมจังหวัด
      let total = 0;
      for (const [, amphoeMonths] of Object.entries(mainAmphoeMap[mainIndId])) {
        for (let i = months.length - 1; i >= 0; i--) {
          const v = amphoeMonths[months[i]] || 0;
          if (v > 0) {
            total += v;
            break;
          }
        }
      }
      return total;
    };

    const hasMainIndData = (mainIndId) => !!mainTotalMap[mainIndId];
    const countMainIndDistricts = (mainIndId) => {
      if (!mainAmphoeMap[mainIndId]) return { count: 0, names: [] };
      const names = Object.entries(mainAmphoeMap[mainIndId])
        .filter(([, months]) => ALL_MONTHS.some((m) => (months[m] || 0) > 0))
        .map(([name]) => name)
        .sort();
      return { count: names.length, names };
    };

    // Indicator 3 target: total DM patients (kpi_id=16 month=0 sum)
    const ind3Target = getTargetSum([16]);
    const ind3Result = getSum([16], ALL_MONTHS);
    const ind3Sub_target = ind3Result; // DM Remission target = those who learned
    const ind3Sub_result = getSum([17], ALL_MONTHS);
    // Override: สำหรับ main_ind_id=4 ให้ใช้เป้าหมายจาก kpi_main_records.kpi_value (report_month=0) ถ้ามี
    const ind3Sub_target_final =
      getMainIndTarget(4) > 0 ? getMainIndTarget(4) : ind3Sub_target;

    const ind8 = countDistrictsWithData(27);
    const ind9 = countDistrictsWithData(28);
    const ind10 = countDistrictsWithData(29);

    // buildInd ที่รวม main indicator override:
    // เป้าหมาย: ดึงจากระดับจังหวัด (kpi_main_records NULL-amphoe) เท่านั้น
    // ผลงาน: ใช้ค่าเดือนล่าสุดจาก main_records ถ้ามี ไม่งั้นใช้ resultVal
    const buildIndWithOverride = (
      no,
      name,
      note,
      targetVal,
      resultVal,
      unit,
      mainIndId,
    ) => {
      let t = mainIndId ? getMainIndTarget(mainIndId) : targetVal;
      let r = resultVal;
      if (mainIndId && hasMainIndData(mainIndId)) {
        const mr = getMainIndLatest(mainIndId, ALL_MONTHS);
        if (mr > 0) r = mr;
      }
      const pct = t > 0 ? Math.round((r / t) * 10000) / 100 : 0;
      return {
        no,
        name,
        note,
        target: t,
        result: r,
        percentage: pct,
        unit,
        main_ind_id: mainIndId || null,
        has_main_data: mainIndId ? hasMainIndData(mainIndId) : false,
      };
    };

    const report = {
      fiscalYear: fy,
      issues: [
        {
          id: 1,
          name: "เด็กโคราช ฉลาดสมวัย IQ มากกว่า 103",
          color: "issue1",
          indicators: [
            // ind1: kpi_id 2,4,5 = จำนวนเด็กที่ได้รับยาน้ำเสริมธาตุเหล็ก (ศพด./รร./ชุมชน)
            buildIndWithOverride(
              1,
              "เด็ก 0-5 ปี ได้รับยาน้ำเสริมธาตุเหล็กทุกสัปดาห์\nไม่น้อยกว่าร้อยละ 85",
              "",
              getTargetSum([2, 4, 5]),
              getSum([2, 4, 5], ALL_MONTHS),
              "คน",
              1,
            ),
            // ind2: เป้าหมาย=เด็กที่ชั่งน้ำหนัก (11,14 month=0), ผลงาน=เด็กสมส่วน (12,15 month≠0)
            buildIndWithOverride(
              2,
              "เด็ก 0-5 ปี มีรูปร่างสมส่วน\nไม่น้อยกว่าร้อยละ 72",
              "",
              getTargetSum([11, 14]),
              getSum([12, 15], ALL_MONTHS),
              "คน",
              2,
            ),
          ],
        },
        {
          id: 2,
          name: "คนโคราชห่างไกลโรค NCDs",
          color: "issue2",
          indicators: [
            {
              ...buildIndWithData(
                3,
                "ผู้ป่วยเบาหวานเข้ารับการปรับเปลี่ยนพฤติกรรมสุขภาพโรงเรียนเบาหวาน ร้อยละ 10",
                "**ผู้ป่วยสะสมทั้งจังหวัด",
                ind3Target,
                ind3Result,
                "คน",
                3,
              ),
              sub: buildIndWithData(
                null,
                "และปรับเปลี่ยนพฤติกรรมเข้าสู่ระยะเบาหวานสงบ (DM Remission) ร้อยละ 1",
                "",
                ind3Sub_target_final,
                ind3Sub_result,
                "คน",
                4,
              ),
            },
            buildIndWithOverride(
              4,
              "ประชาชนอายุ 15 ขึ้นไป มีความรู้เรื่องการปรับเปลี่ยนพฤติกรรมสุขภาพ\nเพื่อลดความเสี่ยงในการป่วยด้วยโรคเบาหวานและความดันโลหิตสูง ร้อยละ 80",
              "",
              getTargetSum([18]),
              getLatestValue([18], ALL_MONTHS),
              "คน",
              5,
            ),
          ],
        },
        {
          id: 3,
          name: "คนโคราชปลอดภัยโรคติดต่อที่ป้องกันได้(โรคพิษสุนัขบ้า)",
          color: "issue3",
          indicators: [
            buildIndWithOverride(
              5,
              "ผู้ที่สัมผัสโรคได้รับการฉีดวัคซีนป้องกัน\nตามแนวทางเวชปฏิบัติ ร้อยละ 100",
              "",
              getTargetSum([19]),
              getSum([20], ALL_MONTHS),
              "คน",
              6,
            ),
            buildIndWithOverride(
              6,
              "สุนัขและแมวได้รับการฉีดวัคซีนพิษสุนัขบ้า ร้อยละ 80",
              "",
              getTargetSum([22]),
              getSum([22], ALL_MONTHS),
              "ตัว",
              7,
            ),
          ],
        },
        {
          id: 4,
          name: "การจัดการสุขภาพจิต ยาเสพติด และการฆ่าตัวตาย",
          color: "issue4",
          indicators: [
            (() => {
              const r7 = hasMainIndData(8)
                ? getMainIndLatest(8, ALL_MONTHS)
                : getSum([26], ALL_MONTHS);
              const t7 =
                hasMainIndData(8) && getMainIndTarget(8) > 0
                  ? getMainIndTarget(8)
                  : 7.8;
              return {
                no: 7,
                name: "อัตราการฆ่าตัวตายสำเร็จไม่เกิน 7.8 ต่อประชากรแสนคน",
                note: "",
                target: t7,
                target_label: "ไม่เกิน",
                result: r7,
                percentage: Math.round((r7 / t7) * 10000) / 100,
                unit: "",
                target_unit: "ต่อแสน",
                main_ind_id: 8,
                has_main_data: hasMainIndData(8),
              };
            })(),
          ],
        },
        {
          id: 5,
          name: "เมืองแห่งสุขภาพดี สิ่งแวดล้อมเอื้อต่อสุขภาพ",
          color: "issue5",
          indicators: [
            (() => {
              if (hasMainIndData(9)) {
                const t = getMainIndTarget(9) || 32,
                  r = getMainIndLatest(9, ALL_MONTHS);
                const md = countMainIndDistricts(9);
                return {
                  no: 8,
                  name: "องค์กรปกครองส่วนท้องถิ่นก่อสร้างระบบบำบัดสิ่งปฏิกูลจากรถสูบส้วม อำเภอละ 1 แห่ง",
                  note: "",
                  target: t,
                  target_unit: "อำเภอ",
                  result: r || md.count,
                  result_unit: "อำเภอ",
                  result_names: md.names.length ? md.names : ind8.names,
                  percentage: Math.round(((r || md.count) / t) * 10000) / 100,
                  main_ind_id: 9,
                  has_main_data: true,
                };
              }
              return {
                no: 8,
                name: "องค์กรปกครองส่วนท้องถิ่นก่อสร้างระบบบำบัดสิ่งปฏิกูลจากรถสูบส้วม อำเภอละ 1 แห่ง",
                note: "",
                target: 32,
                target_unit: "อำเภอ",
                result: ind8.count,
                result_unit: "อำเภอ",
                result_names: ind8.names,
                percentage: Math.round((ind8.count / 32) * 10000) / 100,
                main_ind_id: 9,
                has_main_data: false,
              };
            })(),
            (() => {
              if (hasMainIndData(10)) {
                const t = getMainIndTarget(10) || 32,
                  r = getMainIndLatest(10, ALL_MONTHS);
                const md = countMainIndDistricts(10);
                return {
                  no: 9,
                  name: "องค์กรปกครองส่วนท้องถิ่นพัฒนาระบบประปาหมู่บ้านผ่านมาตรฐาน\nประปาสะอาด 3 C (clear clean chlorine) กรมอนามัย อำเภอละ 1 แห่ง",
                  note: "",
                  target: t,
                  target_unit: "อำเภอ",
                  result: r || md.count,
                  result_unit: "อำเภอ",
                  result_names: md.names.length ? md.names : ind9.names,
                  percentage: Math.round(((r || md.count) / t) * 10000) / 100,
                  main_ind_id: 10,
                  has_main_data: true,
                };
              }
              return {
                no: 9,
                name: "องค์กรปกครองส่วนท้องถิ่นพัฒนาระบบประปาหมู่บ้านผ่านมาตรฐาน\nประปาสะอาด 3 C (clear clean chlorine) กรมอนามัย อำเภอละ 1 แห่ง",
                note: "",
                target: 32,
                target_unit: "อำเภอ",
                result: ind9.count,
                result_unit: "อำเภอ",
                result_names: ind9.names,
                percentage: Math.round((ind9.count / 32) * 10000) / 100,
                main_ind_id: 10,
                has_main_data: false,
              };
            })(),
          ],
        },
        {
          id: 6,
          name: "การขับเคลื่อนงานอาหารปลอดภัยและสถานประกอบการสุขภาพ",
          color: "issue6",
          indicators: [
            (() => {
              if (hasMainIndData(11)) {
                const t = getMainIndTarget(11) || 32,
                  r = getMainIndLatest(11, ALL_MONTHS);
                const md = countMainIndDistricts(11);
                return {
                  no: 10,
                  name: "การจัดการความเสี่ยงสารตกค้างยาฆ่าแมลงตกค้างในผักผลไม้ ทุกอำเภอ",
                  note: "",
                  target: t,
                  target_unit: "อำเภอ",
                  result: r || md.count,
                  result_unit: "อำเภอ",
                  result_names: md.names.length ? md.names : ind10.names,
                  percentage: Math.round(((r || md.count) / t) * 10000) / 100,
                  main_ind_id: 11,
                  has_main_data: true,
                };
              }
              return {
                no: 10,
                name: "การจัดการความเสี่ยงสารตกค้างยาฆ่าแมลงตกค้างในผักผลไม้ ทุกอำเภอ",
                note: "",
                target: 32,
                target_unit: "อำเภอ",
                result: ind10.count,
                result_unit: "อำเภอ",
                result_names: ind10.names,
                percentage: Math.round((ind10.count / 32) * 10000) / 100,
                main_ind_id: 11,
                has_main_data: false,
              };
            })(),
            buildIndWithOverride(
              11,
              "สถานที่จำหน่ายอาหารผ่านเกณฑ์มาตรฐาน SAN ร้อยละ 85",
              "",
              getTargetSum([31]),
              getSum([31], ALL_MONTHS),
              "แห่ง",
              12,
            ),
          ],
        },
      ],
    };

    // ดึง main indicators ทั้งหมดเพื่อให้ frontend สามารถแสดงชื่อจากตาราง
    let mainIndicators = [];
    try {
      const result = await db.query(
        "SELECT id, name, IFNULL(target_label, '') as target_label FROM kpi_main_indicators ORDER BY id",
      );
      mainIndicators = result[0] || [];
    } catch (queryErr) {
      console.warn(
        "Warning: Failed to fetch main indicators:",
        queryErr.message,
      );
      mainIndicators = [];
    }

    console.log("Agenda report response - issues:", report.issues.length);

    res.json({
      success: true,
      data: report,
      mainIndicators: mainIndicators.map((m) => ({
        id: m.id,
        name: m.name,
        target_label: m.target_label || "",
      })),
    });
  } catch (e) {
    console.error("Agenda report error:", e.message);
    console.error("Stack:", e.stack);

    res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ============================================================
// KPI MAIN RECORDS (ผลงานระดับตัวชี้วัดหลัก — ไม่เกี่ยวกับ kpi_items/kpi_records)
// ============================================================

// GET: ดึงข้อมูล main records ตามปีงบ (optional: amphoe_name)
app.get("/kpikorat/api/main-records", async (req, res) => {
  const fy = parseInt(req.query.fiscalYear) || 2569;
  const amphoe = req.query.amphoe || null;
  try {
    let sql = "SELECT * FROM kpi_main_records WHERE fiscal_year = ?";
    const params = [fy];
    if (amphoe) {
      sql += " AND amphoe_name = ?";
      params.push(amphoe);
    }
    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// GET: สรุปรวมระดับจังหวัด
// - เป้าหมายจังหวัด (report_month = 0): เก็บแยกที่ amphoe_name IS NULL (ไม่ใช่ผลรวมรายอำเภอ)
// - ผลงานรายเดือน (report_month != 0): SUM ของทุก amphoe (amphoe_name IS NOT NULL)
app.get("/kpikorat/api/main-records/summary", async (req, res) => {
  const fy = parseInt(req.query.fiscalYear) || 2569;
  try {
    const [targetRows] = await db.query(
      `SELECT main_ind_id, report_month, kpi_value AS total_value
       FROM kpi_main_records
       WHERE fiscal_year = ? AND report_month = 0 AND amphoe_name IS NULL`,
      [fy],
    );
    const [resultRows] = await db.query(
      `SELECT main_ind_id, report_month, SUM(kpi_value) AS total_value
       FROM kpi_main_records
       WHERE fiscal_year = ? AND report_month != 0 AND amphoe_name IS NOT NULL
       GROUP BY main_ind_id, report_month`,
      [fy],
    );
    res.json({ success: true, data: [...targetRows, ...resultRows] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// POST: batch save main records (upsert)
app.post("/kpikorat/api/main-records/batch", requireAuth, async (req, res) => {
  const { fiscalYear, amphoe_name, changes } = req.body;
  // changes: [{ main_ind_id, month, value }]
  if (!fiscalYear || !Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  }
  const fy = parseInt(fiscalYear);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let count = 0;
    for (const c of changes) {
      const m = parseInt(c.month);
      // คำนวณปี ค.ศ. จากเดือนไทย
      const adYear = m >= 10 ? fy - 544 : fy - 543;
      const val =
        c.value !== null && c.value !== undefined && c.value !== ""
          ? parseFloat(c.value)
          : null;
      const amphoeSafe = amphoe_name || null;

      if (val === null) {
        await conn.query(
          "DELETE FROM kpi_main_records WHERE main_ind_id=? AND fiscal_year=? AND report_month=? AND report_year_ad=? AND (amphoe_name=? OR (amphoe_name IS NULL AND ? IS NULL))",
          [c.main_ind_id, fy, m, adYear, amphoeSafe, amphoeSafe],
        );
      } else {
        await conn.query(
          `INSERT INTO kpi_main_records (main_ind_id, fiscal_year, report_month, report_year_ad, kpi_value, amphoe_name, recorded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE kpi_value=VALUES(kpi_value), recorded_by=VALUES(recorded_by), recorded_at=NOW()`,
          [c.main_ind_id, fy, m, adYear, val, amphoeSafe, req.user?.id || null],
        );
      }
      count++;
    }
    await conn.commit();
    writeLog(
      req,
      "UPDATE",
      "kpi_main_records",
      null,
      `Batch save ${count} main-records fy=${fy} amphoe=${amphoe_name || "จังหวัด"}`,
    );
    res.json({ success: true, count });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  } finally {
    conn.release();
  }
});

// GET: ดึง main records สรุปรายอำเภอ
app.get("/kpikorat/api/main-records/by-amphoe", async (req, res) => {
  const fy = parseInt(req.query.fiscalYear) || 2569;
  try {
    const [rows] = await db.query(
      `SELECT main_ind_id, report_month, amphoe_name, SUM(kpi_value) AS total_value
       FROM kpi_main_records WHERE fiscal_year = ?
       GROUP BY main_ind_id, report_month, amphoe_name
       ORDER BY amphoe_name, main_ind_id, report_month`,
      [fy],
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ============================================================
// KPI MAIN RECORDS ITEMS (ผลงานตัวชี้วัดหลัก + 31 Items)
// ============================================================

// GET: ดึงข้อมูล main records ที่เป็น item-level (แสดง 31 รายการ)
app.get("/kpikorat/api/main-records-items", async (req, res) => {
  try {
    const fy = parseInt(req.query.fiscalYear) || 2569;
    const amphoe = req.query.amphoe_name || null;
    const mainIndId = req.query.main_ind_id
      ? parseInt(req.query.main_ind_id)
      : null;

    let sql = `
      SELECT
        mr.id,
        mr.main_ind_id,
        mr.item_id,
        mr.fiscal_year,
        mr.report_month,
        mr.kpi_value,
        mr.is_visible,
        mr.amphoe_name,
        ki.name AS item_name,
        ki.unit AS item_unit,
        kmi.name AS main_ind_name
      FROM kpi_main_records mr
      LEFT JOIN kpi_items ki ON mr.item_id = ki.id
      LEFT JOIN kpi_main_indicators kmi ON mr.main_ind_id = kmi.id
      WHERE mr.fiscal_year = ?
    `;
    const params = [fy];

    if (amphoe) {
      sql += ` AND (mr.amphoe_name = ? OR (mr.amphoe_name IS NULL AND ? IS NULL))`;
      params.push(amphoe, amphoe);
    } else {
      sql += ` AND mr.amphoe_name IS NULL`;
    }

    if (mainIndId) {
      sql += ` AND mr.main_ind_id = ?`;
      params.push(mainIndId);
    }

    sql += ` ORDER BY mr.main_ind_id, mr.item_id, mr.report_month`;

    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("Get main-records-items error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// GET: ดึงข้อมูลการตั้งค่า configuration สำหรับ main indicator
app.get("/kpikorat/api/main-indicator-config", async (req, res) => {
  try {
    const mainIndId = parseInt(req.query.main_ind_id);
    if (!mainIndId) {
      return res.status(400).json({ error: "ต้องระบุ main_ind_id" });
    }

    const sql = `
      SELECT
        mic.id,
        mic.main_ind_id,
        mic.item_id,
        mic.agenda_field,
        mic.field_index,
        mic.sort_order,
        mic.is_hidden,
        mic.display_name,
        ki.name AS item_name,
        ki.unit AS item_unit,
        ks.name AS sub_activity_name
      FROM main_indicator_item_config mic
      LEFT JOIN kpi_items ki ON mic.item_id = ki.id
      LEFT JOIN kpi_sub_activities ks ON ki.sub_activity_id = ks.id
      WHERE mic.main_ind_id = ?
      ORDER BY mic.sort_order, mic.field_index, mic.item_id
    `;

    const [rows] = await db.query(sql, [mainIndId]);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("Get main-indicator-config error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// GET: ดึงเฉพาะ items ที่ linked กับ main indicator ตัวหนึ่ง
app.get("/kpikorat/api/main-indicator-items", async (req, res) => {
  try {
    const mainIndId = parseInt(req.query.main_ind_id);
    if (!mainIndId) {
      return res.status(400).json({ error: "ต้องระบุ main_ind_id" });
    }

    const sql = `
      SELECT DISTINCT
        ki.id,
        ki.name,
        ki.unit,
        ks.name AS sub_activity_name,
        ks.id AS sub_id,
        COALESCE(mic.sort_order, 0) AS sort_order,
        COALESCE(mic.is_hidden, 0) AS is_hidden,
        COALESCE(mic.agenda_field, 'result') AS agenda_field,
        COALESCE(mic.display_name, ki.name) AS display_name
      FROM kpi_main_indicators kmi
      JOIN kpi_sub_activities ks ON ks.main_ind_id = kmi.id
      JOIN kpi_items ki ON ki.sub_activity_id = ks.id
      LEFT JOIN main_indicator_item_config mic ON mic.main_ind_id = kmi.id AND mic.item_id = ki.id
      WHERE kmi.id = ?
      ORDER BY COALESCE(mic.sort_order, ki.id), ki.id
    `;

    const [rows] = await db.query(sql, [mainIndId]);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("Get main-indicator-items error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// POST: Batch save main record items
app.post(
  "/kpikorat/api/main-records-items/batch",
  requireAuth,
  async (req, res) => {
    const { fiscalYear, amphoe_name, main_ind_id, changes } = req.body;

    if (
      !fiscalYear ||
      !Array.isArray(changes) ||
      changes.length === 0 ||
      !main_ind_id
    ) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
    }

    const fy = parseInt(fiscalYear);
    const amphoeSafe = amphoe_name || null;
    const conn = await pool.promise().getConnection();

    try {
      await conn.beginTransaction();

      let savedCount = 0;
      const auditLogs = [];

      for (const change of changes) {
        const itemId = change.item_id ? parseInt(change.item_id) : null;
        const month = parseInt(change.month);
        const isVisible = change.is_visible !== false ? 1 : 0;
        const val =
          change.value !== null &&
          change.value !== undefined &&
          change.value !== ""
            ? parseFloat(change.value)
            : null;

        const adYear = month >= 10 ? fy - 544 : fy - 543;

        if (val === null) {
          const [delResult] = await conn.query(
            `DELETE FROM kpi_main_records
           WHERE main_ind_id = ? AND fiscal_year = ? AND report_month = ? AND report_year_ad = ?
           AND (amphoe_name = ? OR (amphoe_name IS NULL AND ? IS NULL))
           AND (item_id = ? OR (item_id IS NULL AND ? IS NULL))`,
            [
              main_ind_id,
              fy,
              month,
              adYear,
              amphoeSafe,
              amphoeSafe,
              itemId,
              itemId,
            ],
          );

          if (delResult.affectedRows > 0) {
            auditLogs.push({
              main_ind_id,
              item_id: itemId,
              amphoe_name: amphoeSafe,
              fiscal_year: fy,
              report_month: month,
              old_value: 0,
              new_value: null,
            });
          }
        } else {
          const [insResult] = await conn.query(
            `INSERT INTO kpi_main_records
           (main_ind_id, item_id, fiscal_year, report_month, report_year_ad, kpi_value, is_visible, amphoe_name, recorded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             kpi_value = VALUES(kpi_value),
             is_visible = VALUES(is_visible),
             recorded_by = VALUES(recorded_by),
             recorded_at = NOW()`,
            [
              main_ind_id,
              itemId,
              fy,
              month,
              adYear,
              val,
              isVisible,
              amphoeSafe,
              req.user?.id || null,
            ],
          );

          if (insResult.affectedRows > 0) {
            savedCount++;
            auditLogs.push({
              main_ind_id,
              item_id: itemId,
              amphoe_name: amphoeSafe,
              fiscal_year: fy,
              report_month: month,
              new_value: val,
            });
          }
        }
      }

      if (auditLogs.length > 0) {
        for (const log of auditLogs) {
          await conn.query(
            `INSERT INTO main_record_audit (main_ind_id, item_id, amphoe_name, fiscal_year, report_month, new_value, changed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              log.main_ind_id,
              log.item_id,
              log.amphoe_name,
              log.fiscal_year,
              log.report_month,
              log.new_value,
              req.user?.id || null,
            ],
          );
        }
      }

      await conn.commit();

      writeLog(
        req,
        "UPDATE",
        "kpi_main_records_items",
        main_ind_id,
        `บันทึก ${savedCount} ผลงาน main_ind=${main_ind_id} amphoe=${amphoeSafe || "จังหวัด"}`,
      );

      res.json({ success: true, count: savedCount });
    } catch (e) {
      await conn.rollback();
      console.error("Batch save main-records-items error:", e);
      res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
    } finally {
      conn.release();
    }
  },
);

// POST: Update main indicator item configuration
app.post(
  "/kpikorat/api/main-indicator-config/update",
  requireAuth,
  async (req, res) => {
    const {
      main_ind_id,
      item_id,
      agenda_field,
      field_index,
      sort_order,
      is_hidden,
      display_name,
    } = req.body;

    if (!main_ind_id || !item_id) {
      return res
        .status(400)
        .json({ error: "ต้องระบุ main_ind_id และ item_id" });
    }

    try {
      const [result] = await db.query(
        `INSERT INTO main_indicator_item_config
       (main_ind_id, item_id, agenda_field, field_index, sort_order, is_hidden, display_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         agenda_field = VALUES(agenda_field),
         field_index = VALUES(field_index),
         sort_order = VALUES(sort_order),
         is_hidden = VALUES(is_hidden),
         display_name = VALUES(display_name),
         updated_at = NOW()`,
        [
          main_ind_id,
          item_id,
          agenda_field || null,
          field_index || 0,
          sort_order || 0,
          is_hidden || 0,
          display_name || null,
        ],
      );

      writeLog(
        req,
        "UPDATE",
        "main_indicator_item_config",
        `${main_ind_id}_${item_id}`,
        `config: agenda_field=${agenda_field}, sort_order=${sort_order}`,
      );

      res.json({ success: true, affected: result.affectedRows });
    } catch (e) {
      console.error("Update main-indicator-config error:", e);
      res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
    }
  },
);

// POST: Bulk update visibility settings for items
app.post(
  "/kpikorat/api/main-records-items/visibility/batch",
  requireAuth,
  async (req, res) => {
    const { main_ind_id, amphoe_name, fiscal_year, items } = req.body;

    if (!main_ind_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
    }

    const conn = await pool.promise().getConnection();
    try {
      await conn.beginTransaction();

      const fy = parseInt(fiscal_year) || 2569;
      const amphoeSafe = amphoe_name || null;
      let count = 0;

      for (const item of items) {
        const [result] = await conn.query(
          `UPDATE kpi_main_records
         SET is_visible = ?
         WHERE main_ind_id = ? AND item_id = ? AND fiscal_year = ?
         AND (amphoe_name = ? OR (amphoe_name IS NULL AND ? IS NULL))`,
          [
            item.is_visible ? 1 : 0,
            main_ind_id,
            item.item_id,
            fy,
            amphoeSafe,
            amphoeSafe,
          ],
        );
        count += result.affectedRows;
      }

      await conn.commit();

      writeLog(
        req,
        "UPDATE",
        "kpi_main_records",
        main_ind_id,
        `อัพเดต visibility ${count} records`,
      );

      res.json({ success: true, updated: count });
    } catch (e) {
      await conn.rollback();
      console.error("Batch visibility update error:", e);
      res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
    } finally {
      conn.release();
    }
  },
);

// GET: ดึง summary ของ main indicator records
app.get("/kpikorat/api/main-indicator-summary", async (req, res) => {
  try {
    const mainIndId = parseInt(req.query.main_ind_id);
    const fy = parseInt(req.query.fiscal_year) || 2569;

    if (!mainIndId) {
      return res.status(400).json({ error: "ต้องระบุ main_ind_id" });
    }

    const sql = `
      SELECT
        mr.main_ind_id,
        mr.item_id,
        mr.amphoe_name,
        mr.report_month,
        mr.kpi_value,
        mr.is_visible,
        ki.name AS item_name,
        ki.unit,
        mic.agenda_field,
        mic.display_name
      FROM kpi_main_records mr
      LEFT JOIN kpi_items ki ON mr.item_id = ki.id
      LEFT JOIN main_indicator_item_config mic ON mr.main_ind_id = mic.main_ind_id AND mr.item_id = mic.item_id
      WHERE mr.main_ind_id = ? AND mr.fiscal_year = ? AND mr.is_visible = 1
      ORDER BY mr.amphoe_name, COALESCE(mic.sort_order, mr.item_id), mr.report_month
    `;

    const [rows] = await db.query(sql, [mainIndId, fy]);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("Get main-indicator-summary error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// DELETE: Remove item linkage from main indicator
app.delete(
  "/kpikorat/api/main-indicator-config/:configId",
  requireAuth,
  async (req, res) => {
    const configId = parseInt(req.params.configId);

    try {
      const [result] = await db.query(
        "DELETE FROM main_indicator_item_config WHERE id = ?",
        [configId],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "ไม่พบการตั้งค่า" });
      }

      writeLog(req, "DELETE", "main_indicator_item_config", configId, "");

      res.json({ success: true });
    } catch (e) {
      console.error("Delete config error:", e);
      res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
    }
  },
);

// ============================================================
// KPI MANAGEMENT CRUD
// ============================================================

// Full nested hierarchy (issues → mains → subs → items)
app.get("/kpikorat/api/admin/kpi-full-structure", async (_req, res) => {
  try {
    const [issues] = await db.query(
      "SELECT * FROM kpi_issues ORDER BY issue_no",
    );
    const [mains] = await db.query(
      "SELECT m.*, d.dept_name AS dep_name FROM kpi_main_indicators m LEFT JOIN departments d ON m.dep_id = d.id ORDER BY m.id",
    );
    const [subs] = await db.query(
      "SELECT * FROM kpi_sub_activities ORDER BY id",
    );
    const [items] = await db.query("SELECT * FROM kpi_items ORDER BY id");
    const result = issues.map((issue) => ({
      ...issue,
      main_indicators: mains
        .filter((m) => m.issue_id === issue.id)
        .map((m) => ({
          ...m,
          sub_activities: subs
            .filter((s) => s.main_ind_id === m.id)
            .map((s) => ({
              ...s,
              items: items.filter((i) => i.sub_activity_id === s.id),
            })),
        })),
    }));
    res.json({ success: true, data: result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// kpi_issues
app.post("/kpikorat/api/admin/kpi-issues", async (req, res) => {
  try {
    const { issue_no, name } = req.body;
    const [r] = await db.query(
      "INSERT INTO kpi_issues (issue_no, name) VALUES (?, ?)",
      [issue_no, name],
    );
    writeLog(req, "CREATE", "kpi_issues", r.insertId, name);

    res.json({ success: true, id: r.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.put("/kpikorat/api/admin/kpi-issues/:id", async (req, res) => {
  try {
    const { issue_no, name } = req.body;
    await db.query("UPDATE kpi_issues SET issue_no=?, name=? WHERE id=?", [
      issue_no,
      name,
      req.params.id,
    ]);
    writeLog(req, "UPDATE", "kpi_issues", +req.params.id, name);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.delete("/kpikorat/api/admin/kpi-issues/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM kpi_issues WHERE id=?", [req.params.id]);
    writeLog(req, "DELETE", "kpi_issues", +req.params.id);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// kpi_main_indicators
app.post("/kpikorat/api/admin/kpi-main-indicators", async (req, res) => {
  try {
    const { issue_id, name, target_label, dep_id } = req.body;
    const [r] = await db.query(
      "INSERT INTO kpi_main_indicators (issue_id, name, target_label, dep_id) VALUES (?, ?, ?, ?)",
      [issue_id, name, target_label || null, dep_id || null],
    );
    writeLog(req, "CREATE", "kpi_main_indicators", r.insertId, name);
    res.json({ success: true, id: r.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.put("/kpikorat/api/admin/kpi-main-indicators/:id", async (req, res) => {
  try {
    const { issue_id, name, target_label, dep_id } = req.body;
    await db.query(
      "UPDATE kpi_main_indicators SET issue_id=?, name=?, target_label=?, dep_id=? WHERE id=?",
      [issue_id, name, target_label || null, dep_id || null, req.params.id],
    );
    writeLog(req, "UPDATE", "kpi_main_indicators", +req.params.id, name);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.delete("/kpikorat/api/admin/kpi-main-indicators/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM kpi_main_indicators WHERE id=?", [
      req.params.id,
    ]);
    writeLog(req, "DELETE", "kpi_main_indicators", +req.params.id);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// kpi_sub_activities
app.post("/kpikorat/api/admin/kpi-sub-activities", async (req, res) => {
  try {
    const { main_ind_id, name } = req.body;
    const [r] = await db.query(
      "INSERT INTO kpi_sub_activities (main_ind_id, name) VALUES (?, ?)",
      [main_ind_id, name],
    );
    writeLog(req, "CREATE", "kpi_sub_activities", r.insertId, name);

    res.json({ success: true, id: r.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.put("/kpikorat/api/admin/kpi-sub-activities/:id", async (req, res) => {
  try {
    const { main_ind_id, name } = req.body;
    await db.query(
      "UPDATE kpi_sub_activities SET main_ind_id=?, name=? WHERE id=?",
      [main_ind_id, name, req.params.id],
    );
    writeLog(req, "UPDATE", "kpi_sub_activities", +req.params.id, name);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.delete("/kpikorat/api/admin/kpi-sub-activities/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM kpi_sub_activities WHERE id=?", [
      req.params.id,
    ]);
    writeLog(req, "DELETE", "kpi_sub_activities", +req.params.id);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// kpi_items
app.post("/kpikorat/api/admin/kpi-items", async (req, res) => {
  try {
    const { sub_activity_id, name, unit, target_value, custom_id } = req.body;
    let newId = custom_id;
    if (!newId) {
      const [[maxRow]] = await db.query(
        "SELECT COALESCE(MAX(id),0)+1 AS nextId FROM kpi_items",
      );
      newId = maxRow.nextId;
    }
    await db.query(
      "INSERT INTO kpi_items (id, sub_activity_id, name, unit, target_value) VALUES (?, ?, ?, ?, ?)",
      [newId, sub_activity_id, name, unit || null, target_value || null],
    );
    writeLog(req, "CREATE", "kpi_items", newId, name);

    res.json({ success: true, id: newId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.put("/kpikorat/api/admin/kpi-items/:id", async (req, res) => {
  try {
    const { sub_activity_id, name, unit, target_value } = req.body;
    await db.query(
      "UPDATE kpi_items SET sub_activity_id=?, name=?, unit=?, target_value=? WHERE id=?",
      [
        sub_activity_id,
        name,
        unit || null,
        target_value || null,
        req.params.id,
      ],
    );
    writeLog(req, "UPDATE", "kpi_items", +req.params.id, name);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.delete("/kpikorat/api/admin/kpi-items/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM kpi_items WHERE id=?", [req.params.id]);
    writeLog(req, "DELETE", "kpi_items", +req.params.id);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ============================================================
// USERS MANAGEMENT CRUD
// ============================================================

app.get("/kpikorat/api/admin/users-all", async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.hospital_name, u.amphoe_name, u.role, u.hospcode, u.dep_id, u.created_at,
              COALESCE(u.status,1) AS status, d.dept_name AS dep_name
       FROM users u LEFT JOIN departments d ON u.dep_id = d.id
       ORDER BY u.amphoe_name, u.hospital_name`,
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// Toggle user status
app.patch("/kpikorat/api/admin/users/:id/status", async (req, res) => {
  try {
    const newStatus = req.body.status ? 1 : 0;
    await db.query("UPDATE users SET status=? WHERE id=?", [
      newStatus,
      req.params.id,
    ]);
    writeLog(
      req,
      "UPDATE",
      "users",
      +req.params.id,
      `เปลี่ยนสถานะเป็น ${newStatus ? "เปิด" : "ปิด"}`,
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.post("/kpikorat/api/admin/users", async (req, res) => {
  try {
    const {
      username,
      password,
      hospital_name,
      amphoe_name,
      role,
      hospcode,
      dep_id,
    } = req.body;
    const VALID_ROLES = [
      "user",
      "admin",
      "admin_cup",
      "admin_ssj",
      "super_admin",
    ];
    const safeRole = VALID_ROLES.includes(role) ? role : "user";
    const hashedPw = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const [r] = await db.query(
      "INSERT INTO users (username, password_hash, password_version, hospital_name, amphoe_name, role, hospcode, dep_id) VALUES (?, ?, 1, ?, ?, ?, ?, ?)",
      [
        username,
        hashedPw,
        hospital_name,
        amphoe_name,
        safeRole,
        hospcode || null,
        dep_id || null,
      ],
    );
    writeLog(
      req,
      "CREATE",
      "users",
      r.insertId,
      `สร้างผู้ใช้ ${username} role=${safeRole}`,
    );
    res.json({ success: true, id: r.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.put("/kpikorat/api/admin/users/:id", async (req, res) => {
  try {
    const {
      username,
      hospital_name,
      amphoe_name,
      role,
      hospcode,
      password,
      dep_id,
    } = req.body;
    const VALID_ROLES = [
      "user",
      "admin",
      "admin_cup",
      "admin_ssj",
      "super_admin",
    ];
    const safeRole = VALID_ROLES.includes(role) ? role : "user";
    if (password) {
      const hashedPw = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await db.query(
        "UPDATE users SET username=?, hospital_name=?, amphoe_name=?, role=?, hospcode=?, dep_id=?, password_hash=?, password_version=1 WHERE id=?",
        [
          username,
          hospital_name,
          amphoe_name,
          safeRole,
          hospcode || null,
          dep_id || null,
          hashedPw,
          req.params.id,
        ],
      );
    } else {
      await db.query(
        "UPDATE users SET username=?, hospital_name=?, amphoe_name=?, role=?, hospcode=?, dep_id=? WHERE id=?",
        [
          username,
          hospital_name,
          amphoe_name,
          safeRole,
          hospcode || null,
          dep_id || null,
          req.params.id,
        ],
      );
    }
    writeLog(
      req,
      "UPDATE",
      "users",
      +req.params.id,
      `แก้ไขผู้ใช้ ${username} role=${safeRole}`,
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});
app.delete("/kpikorat/api/admin/users/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM users WHERE id=?", [req.params.id]);
    writeLog(
      req,
      "DELETE",
      "users",
      +req.params.id,
      `ลบผู้ใช้ id=${req.params.id}`,
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ─── Export Admin Report → Excel ─────────────────────────────────────────────
app.get("/kpikorat/api/admin/report-excel", requireAdmin, async (req, res) => {
  const fy = validFiscalYear(req.query.fiscalYear);
  if (!fy) return res.status(400).json({ error: "ปีงบประมาณไม่ถูกต้อง" });
  const { amphoe, issueId, itemId } = req.query;

  try {
    let baseSql = `
      FROM kpi_records r
      JOIN users u ON r.user_id = u.id
      JOIN kpi_items it ON r.kpi_id = it.id
      JOIN kpi_sub_activities s ON it.sub_activity_id = s.id
      JOIN kpi_main_indicators m ON s.main_ind_id = m.id
      JOIN kpi_issues i ON m.issue_id = i.id
      WHERE r.fiscal_year = ? AND u.role = 'user'
    `;
    const params = [fy];
    if (amphoe && amphoe !== "ทั้งหมด") {
      baseSql += " AND u.amphoe_name = ?";
      params.push(amphoe);
    }
    if (issueId && issueId !== "all") {
      baseSql += " AND i.id = ?";
      params.push(issueId);
    }
    if (itemId && itemId !== "all") {
      baseSql += " AND it.id = ?";
      params.push(itemId);
    }

    const dataSql = `
      SELECT u.hospcode, u.hospital_name, u.amphoe_name, r.fiscal_year,
             i.name AS issue_name, m.name AS main_name, s.name AS sub_name,
             it.name AS item_name, it.unit,
             MAX(CASE WHEN r.report_month = 0 THEN r.kpi_value ELSE 0 END) AS target,
             SUM(CASE WHEN r.report_month > 0 THEN r.kpi_value ELSE 0 END) AS result
      ${baseSql}
      GROUP BY r.user_id, r.kpi_id
      ORDER BY u.amphoe_name, u.hospital_name, i.id, it.id
      LIMIT 5000
    `;
    const [rows] = await db.query(dataSql, params);

    const wb = XLSX.utils.book_new();
    const wsData = [
      [
        "รหัส",
        "โรงพยาบาล",
        "อำเภอ",
        "ปีงบ",
        "ประเด็น",
        "ตัวชี้วัดหลัก",
        "กิจกรรมย่อย",
        "รายการ",
        "หน่วย",
        "เป้าหมาย",
        "ผลงาน",
        "%",
      ],
      ...rows.map((r) => [
        r.hospcode,
        r.hospital_name,
        r.amphoe_name,
        r.fiscal_year,
        r.issue_name,
        r.main_name,
        r.sub_name,
        r.item_name,
        r.unit,
        r.target,
        r.result,
        r.target > 0 ? Math.round((r.result / r.target) * 10000) / 100 : 0,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [8, 30, 15, 8, 30, 30, 30, 40, 8, 10, 10, 8].map((w) => ({
      wch: w,
    }));
    XLSX.utils.book_append_sheet(wb, ws, "รายงาน KPI");

    writeLog(
      req,
      "EXPORT_REPORT",
      "kpi_records",
      null,
      `ส่งออกรายงาน Excel ปี ${fy}`,
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="kpi_report_${fy}.xlsx"`,
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(buf);
  } catch (e) {
    console.error("Report Excel error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ─── Change Password (ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง) ─────────────────────────
app.post("/kpikorat/api/me/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "กรุณากรอกรหัสผ่านให้ครบถ้วน" });
  }
  if (newPassword.length < 6) {
    return res
      .status(400)
      .json({ error: "รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร" });
  }
  try {
    const [rows] = await db.query(
      "SELECT password_hash, password_version FROM users WHERE id = ?",
      [req.user.id],
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "ไม่พบผู้ใช้" });
    }

    const user = rows[0];
    let currentPasswordValid = false;

    if (+user.password_version === 1) {
      currentPasswordValid = await bcrypt.compare(
        currentPassword,
        user.password_hash,
      );
    } else {
      const [sha2Check] = await db.query(
        "SELECT id FROM users WHERE id = ? AND password_hash = SHA2(?, 256)",
        [req.user.id, currentPassword],
      );
      currentPasswordValid = sha2Check.length > 0;
    }

    if (!currentPasswordValid) {
      return res.status(401).json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.query(
      "UPDATE users SET password_hash = ?, password_version = 1 WHERE id = ?",
      [newHash, req.user.id],
    );
    writeLog(
      req,
      "CHANGE_PASSWORD",
      "users",
      req.user.id,
      "เปลี่ยนรหัสผ่านตัวเอง",
    );
    res.json({ success: true });
  } catch (e) {
    console.error("Change password error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ─── Audit Logs (Admin เท่านั้น) ──────────────────────────────────────────────
app.get("/kpikorat/api/admin/audit-logs", requireAdmin, async (req, res) => {
  const page = validPage(req.query.page);
  const limit = Math.min(100, validLimit(req.query.limit));
  const offset = (page - 1) * limit;
  try {
    const [[{ total }]] = await db.query(
      "SELECT COUNT(*) AS total FROM system_logs",
    );
    const [rows] = await db.query(
      "SELECT * FROM system_logs ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [limit, offset],
    );
    res.json({ success: true, data: rows, total, page, limit });
  } catch (e) {
    console.error("Audit logs error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ─── Auto-create/migrate tables on startup ───────────────────────────────────
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        user_id      INT,
        username     VARCHAR(100),
        role         VARCHAR(20),
        action       VARCHAR(50),
        entity_type  VARCHAR(50),
        entity_id    INT,
        detail       TEXT,
        ip_address   VARCHAR(45),
        created_at   DATETIME DEFAULT NOW(),
        INDEX idx_created_at (created_at),
        INDEX idx_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("✅ system_logs table ready");
  } catch (e) {
    console.error("system_logs table error:", e.message);
  }

  // เพิ่ม password_version column สำหรับ bcrypt migration
  try {
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_version TINYINT NOT NULL DEFAULT 0
      COMMENT '0=SHA2 legacy, 1=bcrypt'
    `);
    console.log("✅ users.password_version column ready");
  } catch (e) {
    // column อาจมีอยู่แล้ว — ไม่เป็นไร
    if (!e.message.includes("Duplicate column")) {
      console.error("password_version migration error:", e.message);
    }
  }
})();

// ─── Token Refresh (ต่ออายุ token ก่อนหมดอายุ) ──────────────────────────────
app.post("/kpikorat/api/refresh-token", requireAuth, (req, res) => {
  try {
    const payload = {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      hospcode: req.user.hospcode,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ success: true, token });
  } catch (e) {
    console.error("Refresh token error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// ─── Health Check Endpoint ──────────────────────────────────────────────────
app.get("/kpikorat/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", db: "connected", uptime: process.uptime() });
  } catch (e) {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

// ─── Pool health monitoring ─────────────────────────────────────────────────
const poolMonitorInterval = setInterval(() => {
  const p = pool.pool;
  if (p) {
    const free = p._freeConnections?.length || 0;
    const used = p._allConnections?.length || 0;
    const queued = p._connectionQueue?.length || 0;
    if (queued > 20) {
      console.warn(`⚠️ DB Pool: used=${used}, free=${free}, queued=${queued}`);
    }
  }
}, 30000);
poolMonitorInterval.unref(); // ไม่บล็อก process exit

const PORT = process.env.PORT || 8809;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
