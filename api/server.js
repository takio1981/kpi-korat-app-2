const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const XLSX = require("xlsx");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

const app = express();
app.set('trust proxy', 1); // trust first proxy (Nginx)
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
  const allowedOrigins = corsAllowedOrigins.split(',').map(origin => origin.trim());
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
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

// จำกัด request body ไม่เกิน 500KB — ป้องกัน DoS จาก large JSON payload
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: false, limit: '500kb' }));

// ─── JWT Secret ───────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'korat-kpi-jwt-secret-2025';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// ─── Rate Limiters ────────────────────────────────────────────────────────────
// Login: max 15 ครั้ง/15 นาที ต่อ IP (ป้องกัน brute-force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'พยายาม login มากเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' }
});

// API ทั่วไป: max 300 ครั้ง/นาที ต่อ IP (ป้องกัน scraping/DoS)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Request มากเกินไป กรุณารอสักครู่' }
});
// ข้าม Login เพื่อไม่ให้ถูก 2 limiter พร้อมกัน (loginLimiter เข้มกว่าอยู่แล้ว)
app.use('/kpikorat/api/', (req, res, next) => {
  if (req.path === '/login') return next();
  apiLimiter(req, res, next);
});

// ─── Validation Helpers ───────────────────────────────────────────────────────
function validFiscalYear(y) {
  const n = parseInt(y);
  return Number.isInteger(n) && n >= 2560 && n <= 2600 ? n : null;
}
function validPage(p)  { const n = parseInt(p);  return Number.isInteger(n)  && n >= 1    ? n : 1;   }
function validLimit(l) { const n = parseInt(l);  return Number.isInteger(n)  && n >= 1    ? Math.min(n, 500) : 50; }

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  }
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  }
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });
    }
    next();
  } catch {
    res.status(401).json({ error: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

// ─── Apply Auth to Protected Routes ──────────────────────────────────────────
// Routes ที่ต้องการแค่ login (ผู้ใช้ทั่วไปก็เข้าได้)
const AUTH_ONLY_ADMIN_PATHS = ['/amphoes', '/hospitals', '/import-template', '/import-excel-preview', '/import-excel'];
app.use('/kpikorat/api/admin', (req, res, next) => {
  const needsAuthOnly = AUTH_ONLY_ADMIN_PATHS.some(p => req.path.startsWith(p));
  if (needsAuthOnly) requireAuth(req, res, next);
  else requireAdmin(req, res, next);
});
// บันทึกข้อมูล KPI ต้อง login
app.use('/kpikorat/api/kpi-data/batch', requireAuth);

// ─── Helper: บันทึก Audit Log ─────────────────────────────────────────────────
async function writeLog(req, action, entityType, entityId, detail = '') {
  try {
    const u = req.user || {};
    const ip = req.ip || req.headers['x-forwarded-for'] || '';
    await db.query(
      'INSERT INTO system_logs (user_id, username, role, action, entity_type, entity_id, detail, ip_address) VALUES (?,?,?,?,?,?,?,?)',
      [u.id || null, u.username || '', u.role || '', action, entityType, entityId || null, detail, String(ip).split(',')[0].trim()]
    );
  } catch (_) { /* ไม่ block request ถ้า log ล้มเหลว */ }
}

// ตั้งค่า Database
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 50, // เพิ่ม connectionLimit เพื่อรองรับผู้ใช้งานพร้อมกันมากขึ้น
  queueLimit: 0,
});
const db = pool.promise();

app.get("/kpikorat/api/dashboard/summary", async (req, res) => {
  try {
    const fiscal_year = validFiscalYear(req.query.fiscal_year) || 2569;
    const district_id = req.query.district_id || 'all';

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
                WHERE rec.fiscal_year = ?
                AND (u.amphoe_name = ? OR ? = 'all')
            ) r ON it.id = r.kpi_id
            GROUP BY iss.id, ind.id, iss.name, ind.name
            ORDER BY iss.id ASC, ind.id ASC
        `;

    const [rows] = await db.execute(sql, [fiscal_year, district_id, district_id]);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("Dashboard Summary Error:", e);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 1. API Login ---
app.post("/kpikorat/api/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน" });
  }
  try {
    const [rows] = await db.query(
      `SELECT id, username, hospital_name, amphoe_name, role, hospcode, status
       FROM users
       WHERE username = ? AND password_hash = SHA2(?, 256)`,
      [username, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง" });
    }

    const user = rows[0];
    if (+user.status === 0) {
      return res.status(403).json({ success: false, message: "บัญชีถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ" });
    }

    // สร้าง JWT Token
    const payload = { id: user.id, username: user.username, role: user.role, hospcode: user.hospcode };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // ส่งกลับ user info + token (ไม่ส่ง status กลับ)
    const { status: _s, ...userInfo } = user;
    res.json({ success: true, user: userInfo, token });
  } catch (e) {
    console.error("Login Error:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในระบบ" });
  }
});

// --- 2. API โครงสร้าง KPI (Logic เดียวกับ code.gs) ---
app.get("/kpikorat/api/kpi-structure", async (req, res) => {
  try {
    // ดึงข้อมูลโดย Join 4 ตารางเพื่อให้ได้โครงสร้างครบถ้วน
    // สังเกตว่าใน SQL คุณมี field 'issue_no' ด้วย ผมเลยเพิ่มเข้าไปเพื่อให้เรียงลำดับถูกต้อง
    const sql = `
            SELECT
                i.id AS issue_id, i.name AS issue_name,
                m.id AS main_id, m.name AS main_name, m.target_label,
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 3. API ดึงข้อมูลคะแนน (GetData) — ต้อง login ---
// Admin สามารถระบุ targetUserId เพื่อดูข้อมูลของหน่วยบริการอื่นได้
app.get("/kpikorat/api/kpi-data", requireAuth, async (req, res) => {
  const targetId = parseInt(req.query.userId);
  const userId = (req.user.role === 'admin' && Number.isInteger(targetId) && targetId > 0)
    ? targetId
    : req.user.id;
  const fiscalYear = validFiscalYear(req.query.fiscalYear);
  if (!fiscalYear) return res.status(400).json({ error: 'ปีงบประมาณไม่ถูกต้อง' });
  try {
    const [rows] = await db.query(
      "SELECT kpi_id, report_month, kpi_value FROM kpi_records WHERE user_id = ? AND fiscal_year = ?",
      [userId, fiscalYear],
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 4. API บันทึกข้อมูล (SaveData) — ใช้ userId จาก JWT เสมอ ---
app.post("/kpikorat/api/kpi-data/batch", async (req, res) => {
  // req.user มาจาก requireAuth middleware ที่ผูกไว้ข้างบน
  const userId = req.user.id;
  const { fiscalYear, changes } = req.body;

  const fy = validFiscalYear(fiscalYear);
  if (!fy) return res.status(400).json({ error: 'ปีงบประมาณไม่ถูกต้อง' });
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะบันทึก' });
  }
  if (changes.length > 1000) {
    return res.status(400).json({ error: 'บันทึกได้ไม่เกิน 1000 รายการต่อครั้ง' });
  }

  const conn = await pool.promise().getConnection();
  try {
    await conn.beginTransaction();

    // ใช้ hospcode จาก JWT token โดยตรง — ไม่ต้อง round-trip DB
    const userHospcode = req.user.hospcode || null;

    // แยกข้อมูลที่จะ Insert/Update ออกจากข้อมูลที่จะ Delete
    const toInsert = [];
    const toDeleteIds = [];

    for (let item of changes) {
      if (item.value !== null && item.value !== "") {
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
      } else {
        toDeleteIds.push({ kpi_id: item.kpi_id, month: item.month });
      }
    }

    // 2. ทำ Bulk Insert (บันทึกหลาย Row พร้อมกัน)
    if (toInsert.length > 0) {
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
      const deletePlaceholders = toDeleteIds.map(() => "(?, ?, ?)").join(", ");
      const deleteValues = toDeleteIds.flatMap((d) => [
        userId,
        d.kpi_id,
        d.month,
      ]);

      await conn.query(
        `DELETE FROM kpi_records WHERE (user_id, kpi_id, report_month) IN (${deletePlaceholders})`,
        deleteValues,
      );
    }

    await conn.commit();
    res.json({ success: true, count: changes.length });
  } catch (e) {
    await conn.rollback();
    console.error("Batch Save Error:", e);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 7. API ตัวเลือกสำหรับตัวกรอง (Issues & Items) ---
app.get("/kpikorat/api/admin/kpi-options", async (req, res) => {
  try {
    // ดึงรายชื่อประเด็น
    const [issues] = await db.query(
      "SELECT id, name FROM kpi_issues ORDER BY id",
    );
    // ดึงรายชื่อตัวชี้วัด (Items)
    const [items] = await db.query(
      "SELECT id, name FROM kpi_items ORDER BY id",
    );
    res.json({ success: true, issues, items });
  } catch (e) {
    console.error(e);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 8. API รายงานละเอียด (Detailed Report) พร้อม Pagination ---
app.get("/kpikorat/api/admin/report", async (req, res) => {
  const fy    = validFiscalYear(req.query.fiscalYear);
  const pPage = validPage(req.query.page);
  const pLimit = validLimit(req.query.limit);
  if (!fy) return res.status(400).json({ error: 'ปีงบประมาณไม่ถูกต้อง' });
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
            WHERE r.fiscal_year = ? AND u.role != 'admin'
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
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

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// -------------------------------------------------------------------------
// ✅ เพิ่ม API ใหม่: สำหรับ Dashboard สรุปผลงาน แยกตามประเด็น
// -------------------------------------------------------------------------
app.get("/kpikorat/api/districts", async (req, res) => {
  try {
    // ดึงชื่ออำเภอที่ไม่ซ้ำกันจากตาราง users
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
  const { fiscalYear } = req.query;
  try {
    const [rows] = await db.query(
      `SELECT r.kpi_id, r.report_month, SUM(r.kpi_value) AS total_value
       FROM kpi_records r
       JOIN users u ON r.user_id = u.id
       WHERE r.fiscal_year = ? AND u.role != 'admin'
       GROUP BY r.kpi_id, r.report_month`,
      [fiscalYear || 2569]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 11. API รายชื่อหน่วยบริการทั้งหมด (สำหรับ Admin) ---
app.get("/kpikorat/api/admin/hospitals", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, hospital_name, amphoe_name, hospcode, username
       FROM users WHERE role != 'admin'
       ORDER BY amphoe_name, hospital_name`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error(e);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 12. Download Excel Template สำหรับตัวชี้วัดที่เลือก ---
app.get("/kpikorat/api/admin/import-template", async (req, res) => {
  const { kpi_id, byear, hospcode } = req.query;
  if (!kpi_id) return res.status(400).json({ success: false, message: 'กรุณาระบุ kpi_id' });

  try {
    // ดึงชื่อตัวชี้วัด
    const [[kpiItem]] = await db.query(`SELECT id, name FROM kpi_items WHERE id = ?`, [kpi_id]);
    if (!kpiItem) return res.status(404).json({ success: false, message: 'ไม่พบตัวชี้วัด' });

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
    const hospIds = hospitals.map(h => h.id);
    let existingMap = {};
    if (hospIds.length > 0) {
      const [existingRows] = await db.query(
        `SELECT u.hospcode, r.report_month, r.kpi_value
         FROM kpi_records r
         JOIN users u ON r.user_id = u.id
         WHERE r.kpi_id = ? AND r.fiscal_year = ? AND u.hospcode IN (${hospIds.map(() => '?').join(',')})`,
        [kpi_id, fiscalYear, ...hospIds]
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
      'hospcode', 'hospname', 'ampurname', 'kpi_indicators', 'byear',
      'm_10', 'm_11', 'm_12', 'm_01', 'm_02', 'm_03',
      'm_04', 'm_05', 'm_06', 'm_07', 'm_08', 'm_09'
    ];
    const descriptions = [
      'รหัสหน่วยบริการ\n(ห้ามแก้ไข)', 'ชื่อหน่วยบริการ\n(ห้ามแก้ไข)', 'อำเภอ\n(ห้ามแก้ไข)',
      'ชื่อตัวชี้วัด\n(ห้ามแก้ไข)', `ปีงบประมาณ\n(ห้ามแก้ไข)`,
      `ต.ค.${adYear - 1}`, `พ.ย.${adYear - 1}`, `ธ.ค.${adYear - 1}`,
      `ม.ค.${adYear}`, `ก.พ.${adYear}`, `มี.ค.${adYear}`,
      `เม.ย.${adYear}`, `พ.ค.${adYear}`, `มิ.ย.${adYear}`,
      `ก.ค.${adYear}`, `ส.ค.${adYear}`, `ก.ย.${adYear}`
    ];

    const monthKeys = [10,11,12,1,2,3,4,5,6,7,8,9];
    const dataRows = hospitals.map(h => [
      h.hospcode, h.hospital_name, h.amphoe_name, kpiItem.name, fiscalYear,
      ...monthKeys.map(m => existingMap[`${h.hospcode}_${m}`] ?? 0)
    ]);

    const wsData = [headers, descriptions, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // กำหนดความกว้าง column
    ws['!cols'] = [
      { wch: 12 }, { wch: 40 }, { wch: 18 }, { wch: 50 }, { wch: 12 },
      ...Array(12).fill({ wch: 10 })
    ];
    // Freeze แถว 2 บน (header + description)
    ws['!freeze'] = { xSplit: 0, ySplit: 2 };

    XLSX.utils.book_append_sheet(wb, ws, 'ข้อมูล');

    // Sheet 2: คำอธิบาย
    const infoWs = XLSX.utils.aoa_to_sheet([
      ['คำอธิบายการกรอกข้อมูล'],
      [''],
      ['ตัวชี้วัด:', `KPI ${kpiItem.id}: ${kpiItem.name}`],
      ['ปีงบประมาณ:', fiscalYear],
      [''],
      ['คอลัมน์', 'คำอธิบาย', 'หมายเหตุ'],
      ['hospcode', 'รหัสหน่วยบริการ 5 หลัก', 'ห้ามแก้ไข - ใช้สำหรับ match ข้อมูล'],
      ['hospname', 'ชื่อหน่วยบริการ', 'ห้ามแก้ไข - ข้อมูลอ้างอิง'],
      ['ampurname', 'ชื่ออำเภอ', 'ห้ามแก้ไข - ข้อมูลอ้างอิง'],
      ['kpi_indicators', 'ชื่อตัวชี้วัด', 'ห้ามแก้ไข - ใช้สำหรับ match ข้อมูล'],
      ['byear', 'ปีงบประมาณ (พ.ศ.)', `ห้ามแก้ไข - ต้องเป็น ${fiscalYear}`],
      ['m_10', `ผลงาน ต.ค.${adYear-1}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_11', `ผลงาน พ.ย.${adYear-1}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_12', `ผลงาน ธ.ค.${adYear-1}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_01', `ผลงาน ม.ค.${adYear}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_02', `ผลงาน ก.พ.${adYear}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_03', `ผลงาน มี.ค.${adYear}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_04', `ผลงาน เม.ย.${adYear}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_05', `ผลงาน พ.ค.${adYear}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_06', `ผลงาน มิ.ย.${adYear}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_07', `ผลงาน ก.ค.${adYear}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_08', `ผลงาน ส.ค.${adYear}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      ['m_09', `ผลงาน ก.ย.${adYear}`, 'กรอกเป็นตัวเลข (จำนวนเต็ม)'],
      [''],
      ['หมายเหตุ:', 'กรอกเฉพาะคอลัมน์ m_10 ถึง m_09 เท่านั้น'],
      ['', 'ระบบจะ match ข้อมูลด้วย hospcode เท่านั้น'],
      ['', 'ถ้าเดือนไหนไม่มีข้อมูลให้ใส่ 0'],
    ]);
    infoWs['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, infoWs, 'คำอธิบาย');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `template_kpi${kpi_id}_${fiscalYear}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    console.error('Template error:', e);
    console.error(e);

    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 13. Upload Excel/CSV → import เข้า kpi_records ---
// Helper: parse Excel buffer → validated data rows
async function parseImportFile(buffer, filterHospcode) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: 0 });
  if (rows.length < 3) throw new Error('ไฟล์ไม่มีข้อมูล (ต้องมีอย่างน้อย 1 แถวข้อมูลหลังจาก header 2 แถว)');

  const headerRow = rows[0];
  const colIndex = {};
  const required = ['hospcode','kpi_indicators','byear','m_10','m_11','m_12','m_01','m_02','m_03','m_04','m_05','m_06','m_07','m_08','m_09'];
  for (const col of required) {
    const idx = headerRow.indexOf(col);
    if (idx === -1) throw new Error(`ไม่พบคอลัมน์ "${col}" ใน header`);
    colIndex[col] = idx;
  }

  const months = [
    { col:'m_10', month:10 },{ col:'m_11', month:11 },{ col:'m_12', month:12 },
    { col:'m_01', month:1  },{ col:'m_02', month:2  },{ col:'m_03', month:3  },
    { col:'m_04', month:4  },{ col:'m_05', month:5  },{ col:'m_06', month:6  },
    { col:'m_07', month:7  },{ col:'m_08', month:8  },{ col:'m_09', month:9  },
  ];

  const [kpiItems] = await db.query('SELECT id, name FROM kpi_items');
  const kpiMap = {};
  for (const ki of kpiItems) kpiMap[ki.name.trim()] = ki.id;

  const [users] = await db.query("SELECT id, hospcode FROM users WHERE role != 'admin'");
  const userMap = {};
  for (const u of users) userMap[u.hospcode] = u.id;

  const validRows = [];
  const skipReasons = [];

  for (const row of rows.slice(2)) {
    const hospcode = String(row[colIndex['hospcode']] ?? '').trim().padStart(5, '0');
    if (!hospcode || hospcode === '00000') continue;
    // กรองเฉพาะ hospcode ของ user ที่ส่งมา (ถ้าไม่ใช่ admin)
    if (filterHospcode && hospcode !== filterHospcode) continue;

    const kpiName = String(row[colIndex['kpi_indicators']] ?? '').trim();
    const byear   = parseInt(row[colIndex['byear']]) || 0;
    const userId  = userMap[hospcode];
    const kpiId   = kpiMap[kpiName];

    if (!userId) { skipReasons.push(`hospcode ${hospcode} ไม่พบในระบบ`); continue; }
    if (!kpiId)  { skipReasons.push(`ตัวชี้วัด "${kpiName}" ไม่พบในระบบ`); continue; }
    if (!byear)  { skipReasons.push(`ปีงบประมาณไม่ถูกต้อง (hospcode=${hospcode})`); continue; }

    const adYear = byear - 543;
    const monthVals = {};
    for (const { col, month } of months) {
      monthVals[month] = Math.round(parseFloat(row[colIndex[col]]) || 0);
    }
    validRows.push({ hospcode, kpiName, byear, userId, kpiId, adYear, monthVals });
  }

  return { validRows, skipReasons, months };
}

// Helper: batch query current DB values for valid rows
async function fetchCurrentValues(validRows) {
  if (validRows.length === 0) return {};
  const hospcodes = [...new Set(validRows.map(r => r.hospcode))];
  const byears    = [...new Set(validRows.map(r => r.byear))];
  const hPlc = hospcodes.map(() => '?').join(',');
  const yPlc = byears.map(() => '?').join(',');
  const [recs] = await db.query(
    `SELECT u.hospcode, r.kpi_id, r.report_month, r.fiscal_year, r.kpi_value
     FROM kpi_records r JOIN users u ON r.user_id = u.id
     WHERE u.hospcode IN (${hPlc}) AND r.fiscal_year IN (${yPlc})`,
    [...hospcodes, ...byears]
  );
  const curMap = {};
  for (const rec of recs) {
    curMap[`${rec.hospcode}_${rec.kpi_id}_${rec.report_month}_${rec.fiscal_year}`] = rec.kpi_value;
  }
  return curMap;
}

// --- 13. Preview: เปรียบเทียบก่อน import (ไม่เขียน DB) ---
app.post("/kpikorat/api/admin/import-excel-preview", upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์' });
  // ถ้าไม่ใช่ admin ให้บังคับ filterHospcode = hospcode ของ user จาก JWT เสมอ (ป้องกันนำเข้าข้อมูล user อื่น)
  const filterHospcode = req.user?.role === 'admin'
    ? (req.body.filterHospcode || null)
    : (req.user?.hospcode || null);

  try {
    const { validRows, skipReasons, months } = await parseImportFile(req.file.buffer, filterHospcode);
    if (validRows.length === 0) {
      return res.json({ success: true, summary: { increased:0, decreased:0, unchanged:0, new_record:0, skipped: skipReasons.length }, skip_reasons: skipReasons.slice(0,10) });
    }

    const curMap = await fetchCurrentValues(validRows);
    let increased = 0, decreased = 0, unchanged = 0, new_record = 0;

    for (const row of validRows) {
      for (const { month } of months) {
        const newVal = row.monthVals[month];
        const key = `${row.hospcode}_${row.kpiId}_${month}_${row.byear}`;
        const curVal = curMap[key];
        if (curVal === undefined || curVal === null) {
          if (newVal > 0) new_record++; else unchanged++;
        } else if (newVal > curVal)  { increased++; }
        else if (newVal < curVal)    { decreased++; }
        else                          { unchanged++; }
      }
    }

    res.json({
      success: true,
      summary: { increased, decreased, unchanged, new_record, skipped: skipReasons.length },
      total_data_rows: validRows.length,
      skip_reasons: skipReasons.slice(0, 10)
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// --- 13b. Execute: import Excel → kpi_records (เฉพาะที่เปลี่ยนแปลง) ---
app.post("/kpikorat/api/admin/import-excel", upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์ Excel หรือ CSV' });
  // บังคับ hospcode จาก JWT สำหรับ non-admin
  const filterHospcode = req.user?.role === 'admin'
    ? (req.body.filterHospcode || null)
    : (req.user?.hospcode || null);

  try {
    const { validRows, skipReasons, months } = await parseImportFile(req.file.buffer, filterHospcode);
    if (validRows.length === 0) {
      return res.json({ success: true, imported: 0, updated: 0, skipped: skipReasons.length, total_rows: 0, skip_reasons: skipReasons.slice(0,10) });
    }

    const curMap = await fetchCurrentValues(validRows);
    let imported = 0, updated = 0, unchanged_skip = 0;

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
        if (curVal !== undefined && curVal === newVal) { unchanged_skip++; continue; }

        const yearAd = month >= 10 ? row.adYear - 1 : row.adYear;
        const [result] = await db.execute(insertSql, [row.userId, row.hospcode, row.byear, month, yearAd, row.kpiId, newVal]);
        if (result.affectedRows === 2) updated++;
        else imported++;
      }
    }

    writeLog(req, 'IMPORT', 'kpi_records', null, `นำเข้า ${imported} ใหม่ ${updated} อัพเดต`);
    res.json({
      success: true,
      imported, updated, skipped: skipReasons.length, unchanged_skip,
      total_rows: validRows.length,
      skip_reasons: skipReasons.slice(0, 10)
    });
  } catch (e) {
    console.error('Import Excel error:', e);
    res.status(400).json({ success: false, message: e.message });
  }
});

// --- 14. Preview: สถิติข้อมูลใน kpi_records ที่จะ export ออกไป ---
app.get("/kpikorat/api/admin/export-preview", async (req, res) => {
  try {
    // สถิติแยกตามปีงบ: กี่หน่วยบริการ, กี่ kpi มีข้อมูล
    const [stats] = await db.query(`
      SELECT
        r.fiscal_year AS byear,
        COUNT(DISTINCT r.kpi_id)   AS kpis_with_data,
        COUNT(DISTINCT r.user_id)  AS total_hosps,
        COUNT(*)                   AS total_records
      FROM kpi_records r
      JOIN users u ON r.user_id = u.id AND u.role != 'admin'
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
    const tableNames = existingTables.map(t => t.TABLE_NAME);

    res.json({ success: true, data: stats, existing_tables: tableNames });
  } catch (e) {
    console.error(e);

    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// --- 13. Execute: export kpi_records → s_kpi_report_korathealth_1..31 (pivot เดือน) ---
app.post("/kpikorat/api/admin/export-korathealth", async (req, res) => {
  const { byear } = req.body;
  if (!byear) return res.status(400).json({ success: false, message: 'กรุณาระบุปีงบประมาณ (byear)' });

  let exported_rows = 0, tables_updated = 0;
  const errors = [];

  try {
    // ดึงชื่อตัวชี้วัดทั้งหมด 31 ข้อ
    const [kpiItems] = await db.query('SELECT id, name FROM kpi_items ORDER BY id');
    if (kpiItems.length === 0) {
      return res.json({ success: true, exported_rows: 0, tables_updated: 0, message: 'ไม่พบข้อมูล kpi_items' });
    }

    // ใช้ users เป็นฐาน LEFT JOIN kpi_records → ทุกหน่วยบริการ เดือนที่ไม่มีข้อมูล = 0
    const pivotSql = `
      INSERT INTO \`{TABLE}\`
        (hospcode, hospname, ampurname, kpi_indicators, byear,
         m_10, m_11, m_12, m_01, m_02, m_03, m_04, m_05, m_06, m_07, m_08, m_09,
         result, target)
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
        COALESCE(SUM(r.kpi_value), 0)                                         AS result,
        0                                                                      AS target
      FROM users u
      LEFT JOIN kpi_records r ON r.user_id = u.id AND r.kpi_id = ? AND r.fiscal_year = ?
      WHERE u.role != 'admin'
      GROUP BY u.hospcode, u.hospital_name, u.amphoe_name
    `;

    for (const { id: kpi_id, name: kpiName } of kpiItems) {
      const tableName = `s_kpi_report_korathealth_${kpi_id}`;
      try {
        const [chk] = await db.query(
          `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [tableName]
        );
        if (chk.length === 0) {
          errors.push(`ไม่พบตาราง ${tableName}`);
          continue;
        }

        await db.execute(`DELETE FROM \`${tableName}\` WHERE byear = ?`, [byear]);
        const sql = pivotSql.replace('{TABLE}', tableName);
        // params: kpiName, byear, kpi_id, byear
        const [result] = await db.execute(sql, [kpiName, byear, kpi_id, byear]);
        exported_rows += result.affectedRows;
        tables_updated++;
      } catch (tableErr) {
        errors.push(`${tableName}: ${tableErr.message}`);
      }
    }

    writeLog(req, 'EXPORT', 'kpi_records', null, `ส่งออกปี ${byear} ${tables_updated} ตาราง`);
    res.json({ success: true, exported_rows, tables_updated, byear, errors: errors.length ? errors : undefined });
  } catch (e) {
    console.error('Export error:', e);
    console.error(e);

    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

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
       WHERE r.fiscal_year = ? AND u.role != 'admin'
       GROUP BY r.kpi_id, r.report_month, u.amphoe_name`,
      [fy]
    );

    // totalMap[kpi_id][month] = ยอดรวมทั้งจังหวัด (month=0 คือ target, month อื่น คือ ผลงาน)
    const totalMap = {};
    // amphoeMap[kpi_id][amphoe_name][month] = ผลงานรายอำเภอรายเดือน (ไม่รวม month=0)
    const amphoeMap = {};
    for (const row of records) {
      const id = row.kpi_id, m = row.report_month, v = parseFloat(row.total_value || 0);
      if (!totalMap[id]) totalMap[id] = {};
      totalMap[id][m] = (totalMap[id][m] || 0) + v;
      if (m !== 0) {  // amphoeMap สำหรับนับอำเภอ ไม่รวม month=0
        if (!amphoeMap[id]) amphoeMap[id] = {};
        if (!amphoeMap[id][row.amphoe_name]) amphoeMap[id][row.amphoe_name] = {};
        amphoeMap[id][row.amphoe_name][m] = (amphoeMap[id][row.amphoe_name][m] || 0) + v;
      }
    }

    // ดึงเป้าหมาย (month=0) รวมทุก hospcode — เหมือน dataMap[kpi_id_0] ใน provincial-kpi
    const getTargetSum = (kpiIds) =>
      kpiIds.reduce((s, id) => s + (totalMap[id]?.[0] || 0), 0);

    // ดึงผลรวมผลงานตามเดือนที่ระบุ
    const getSum = (kpiIds, months) =>
      kpiIds.reduce((s, id) =>
        s + months.reduce((ms, m) => ms + (totalMap[id]?.[m] || 0), 0), 0);

    const buildInd = (no, name, note, targetVal, resultVal, unit) => {
      const pct = targetVal > 0 ? Math.round((resultVal / targetVal) * 10000) / 100 : 0;
      return { no, name, note, target: targetVal, result: resultVal, percentage: pct, unit };
    };

    // District count helpers
    const countDistrictsWithData = (kpiId) => {
      if (!amphoeMap[kpiId]) return { count: 0, names: [] };
      const names = Object.entries(amphoeMap[kpiId])
        .filter(([, months]) => ALL_MONTHS.some(m => (months[m] || 0) > 0))
        .map(([name]) => name).sort();
      return { count: names.length, names };
    };

    // Indicator 3 target: total DM patients (kpi_id=16 month=0 sum)
    const ind3Target = getTargetSum([16]);
    const ind3Result = getSum([16], ALL_MONTHS);
    const ind3Sub_target = ind3Result; // DM Remission target = those who learned
    const ind3Sub_result = getSum([17], ALL_MONTHS);

    const ind8 = countDistrictsWithData(27);
    const ind9 = countDistrictsWithData(28);
    const ind10 = countDistrictsWithData(29);

    const report = {
      fiscalYear: fy,
      issues: [
        {
          id: 1, name: 'เด็กโคราช ฉลาดสมวัย IQ มากกว่า 103', color: 'issue1',
          indicators: [
            // ind1: kpi_id 2,4,5 = จำนวนเด็กที่ได้รับยาน้ำเสริมธาตุเหล็ก (ศพด./รร./ชุมชน)
            buildInd(1, 'เด็ก 0-5 ปี ได้รับยาน้ำเสริมธาตุเหล็กทุกสัปดาห์\nไม่น้อยกว่าร้อยละ 85',
              '', getTargetSum([2,4,5]),
              getSum([2,4,5], ALL_MONTHS), 'คน'),
            // ind2: เป้าหมาย=เด็กที่ชั่งน้ำหนัก (11,14 month=0), ผลงาน=เด็กสมส่วน (12,15 month≠0)
            buildInd(2, 'เด็ก 0-5 ปี มีรูปร่างสมส่วน\nไม่น้อยกว่าร้อยละ 72',
              '', getTargetSum([11,14]),
              getSum([12,15], ALL_MONTHS), 'คน'),
          ]
        },
        {
          id: 2, name: 'คนโคราชห่างไกลโรค NCDs', color: 'issue2',
          indicators: [
            {
              ...buildInd(3, 'ผู้ป่วยเบาหวานเข้ารับการปรับเปลี่ยนพฤติกรรมสุขภาพโรงเรียนเบาหวาน ร้อยละ 10',
                '**ผู้ป่วยสะสมทั้งจังหวัด', ind3Target, ind3Result, 'คน'),
              sub: buildInd(null, 'และปรับเปลี่ยนพฤติกรรมเข้าสู่ระยะเบาหวานสงบ (DM Remission) ร้อยละ 1',
                '', ind3Sub_target, ind3Sub_result, 'คน')
            },
            buildInd(4, 'ประชาชนอายุ 15 ขึ้นไป มีความรู้เรื่องการปรับเปลี่ยนพฤติกรรมสุขภาพ\nเพื่อลดความเสี่ยงในการป่วยด้วยโรคเบาหวานและความดันโลหิตสูง ร้อยละ 80',
              '', getTargetSum([18]), getSum([18], ALL_MONTHS), 'คน'),
          ]
        },
        {
          id: 3, name: 'คนโคราชปลอดภัยโรคติดต่อที่ป้องกันได้(โรคพิษสุนัขบ้า)', color: 'issue3',
          indicators: [
            buildInd(5, 'ผู้ที่สัมผัสโรคได้รับการฉีดวัคซีนป้องกัน\nตามแนวทางเวชปฏิบัติ ร้อยละ 100',
              '', getTargetSum([19]), getSum([20], ALL_MONTHS), 'คน'),
            buildInd(6, 'สุนัขและแมวได้รับการฉีดวัคซีนพิษสุนัขบ้า ร้อยละ 80',
              '', getTargetSum([22]), getSum([22], ALL_MONTHS), 'ตัว'),
          ]
        },
        {
          id: 4, name: 'การจัดการสุขภาพจิต ยาเสพติด และการฆ่าตัวตาย', color: 'issue4',
          indicators: [
            { no: 7, name: 'อัตราการฆ่าตัวตายสำเร็จไม่เกิน 7.8 ต่อประชากรแสนคน',
              note: '', target: 7.8, target_label: 'ไม่เกิน', result: getSum([26], ALL_MONTHS),
              percentage: Math.round((getSum([26], ALL_MONTHS) / 7.8) * 10000) / 100,
              unit: '', target_unit: 'ต่อแสน' }
          ]
        },
        {
          id: 5, name: 'เมืองแห่งสุขภาพดี สิ่งแวดล้อมเอื้อต่อสุขภาพ', color: 'issue5',
          indicators: [
            { no: 8, name: 'องค์กรปกครองส่วนท้องถิ่นก่อสร้างระบบบำบัดสิ่งปฏิกูลจากรถสูบส้วม อำเภอละ 1 แห่ง',
              note: '', target: 32, target_unit: 'อำเภอ', result: ind8.count,
              result_unit: 'อำเภอ', result_names: ind8.names,
              percentage: Math.round((ind8.count / 32) * 10000) / 100 },
            { no: 9, name: 'องค์กรปกครองส่วนท้องถิ่นพัฒนาระบบประปาหมู่บ้านผ่านมาตรฐาน\nประปาสะอาด 3 C (clear clean chlorine) กรมอนามัย อำเภอละ 1 แห่ง',
              note: '', target: 32, target_unit: 'อำเภอ', result: ind9.count,
              result_unit: 'อำเภอ', result_names: ind9.names,
              percentage: Math.round((ind9.count / 32) * 10000) / 100 },
          ]
        },
        {
          id: 6, name: 'การขับเคลื่อนงานอาหารปลอดภัยและสถานประกอบการสุขภาพ', color: 'issue6',
          indicators: [
            { no: 10, name: 'การจัดการความเสี่ยงสารตกค้างยาฆ่าแมลงตกค้างในผักผลไม้ ทุกอำเภอ',
              note: '', target: 32, target_unit: 'อำเภอ', result: ind10.count,
              result_unit: 'อำเภอ', result_names: ind10.names,
              percentage: Math.round((ind10.count / 32) * 10000) / 100 },
            buildInd(11, 'สถานที่จำหน่ายอาหารผ่านเกณฑ์มาตรฐาน SAN ร้อยละ 85',
              '', getTargetSum([31]), getSum([31], ALL_MONTHS), 'แห่ง'),
          ]
        }
      ]
    };
    res.json({ success: true, data: report });
  } catch (e) {
    console.error('Agenda report error:', e);
    console.error(e);

    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// ============================================================
// KPI MANAGEMENT CRUD
// ============================================================

// Full nested hierarchy (issues → mains → subs → items)
app.get('/kpikorat/api/admin/kpi-full-structure', async (_req, res) => {
  try {
    const [issues] = await db.query('SELECT * FROM kpi_issues ORDER BY issue_no');
    const [mains]  = await db.query('SELECT * FROM kpi_main_indicators ORDER BY id');
    const [subs]   = await db.query('SELECT * FROM kpi_sub_activities ORDER BY id');
    const [items]  = await db.query('SELECT * FROM kpi_items ORDER BY id');
    const result = issues.map(issue => ({
      ...issue,
      main_indicators: mains.filter(m => m.issue_id === issue.id).map(m => ({
        ...m,
        sub_activities: subs.filter(s => s.main_ind_id === m.id).map(s => ({
          ...s,
          items: items.filter(i => i.sub_activity_id === s.id)
        }))
      }))
    }));
    res.json({ success: true, data: result });
  } catch (e) { console.error(e);
 res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});

// kpi_issues
app.post('/kpikorat/api/admin/kpi-issues', async (req, res) => {
  try {
    const { issue_no, name } = req.body;
    const [r] = await db.query('INSERT INTO kpi_issues (issue_no, name) VALUES (?, ?)', [issue_no, name]);
    writeLog(req, 'CREATE', 'kpi_issues', r.insertId, name);
    res.json({ success: true, id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.put('/kpikorat/api/admin/kpi-issues/:id', async (req, res) => {
  try {
    const { issue_no, name } = req.body;
    await db.query('UPDATE kpi_issues SET issue_no=?, name=? WHERE id=?', [issue_no, name, req.params.id]);
    writeLog(req, 'UPDATE', 'kpi_issues', +req.params.id, name);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.delete('/kpikorat/api/admin/kpi-issues/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM kpi_issues WHERE id=?', [req.params.id]);
    writeLog(req, 'DELETE', 'kpi_issues', +req.params.id);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});

// kpi_main_indicators
app.post('/kpikorat/api/admin/kpi-main-indicators', async (req, res) => {
  try {
    const { issue_id, name, target_label } = req.body;
    const [r] = await db.query(
      'INSERT INTO kpi_main_indicators (issue_id, name, target_label) VALUES (?, ?, ?)',
      [issue_id, name, target_label || null]
    );
    writeLog(req, 'CREATE', 'kpi_main_indicators', r.insertId, name);
    res.json({ success: true, id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.put('/kpikorat/api/admin/kpi-main-indicators/:id', async (req, res) => {
  try {
    const { issue_id, name, target_label } = req.body;
    await db.query(
      'UPDATE kpi_main_indicators SET issue_id=?, name=?, target_label=? WHERE id=?',
      [issue_id, name, target_label || null, req.params.id]
    );
    writeLog(req, 'UPDATE', 'kpi_main_indicators', +req.params.id, name);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.delete('/kpikorat/api/admin/kpi-main-indicators/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM kpi_main_indicators WHERE id=?', [req.params.id]);
    writeLog(req, 'DELETE', 'kpi_main_indicators', +req.params.id);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});

// kpi_sub_activities
app.post('/kpikorat/api/admin/kpi-sub-activities', async (req, res) => {
  try {
    const { main_ind_id, name } = req.body;
    const [r] = await db.query(
      'INSERT INTO kpi_sub_activities (main_ind_id, name) VALUES (?, ?)', [main_ind_id, name]
    );
    writeLog(req, 'CREATE', 'kpi_sub_activities', r.insertId, name);
    res.json({ success: true, id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.put('/kpikorat/api/admin/kpi-sub-activities/:id', async (req, res) => {
  try {
    const { main_ind_id, name } = req.body;
    await db.query(
      'UPDATE kpi_sub_activities SET main_ind_id=?, name=? WHERE id=?', [main_ind_id, name, req.params.id]
    );
    writeLog(req, 'UPDATE', 'kpi_sub_activities', +req.params.id, name);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.delete('/kpikorat/api/admin/kpi-sub-activities/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM kpi_sub_activities WHERE id=?', [req.params.id]);
    writeLog(req, 'DELETE', 'kpi_sub_activities', +req.params.id);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});

// kpi_items
app.post('/kpikorat/api/admin/kpi-items', async (req, res) => {
  try {
    const { sub_activity_id, name, unit, target_value, custom_id } = req.body;
    let newId = custom_id;
    if (!newId) {
      const [[maxRow]] = await db.query('SELECT COALESCE(MAX(id),0)+1 AS nextId FROM kpi_items');
      newId = maxRow.nextId;
    }
    await db.query(
      'INSERT INTO kpi_items (id, sub_activity_id, name, unit, target_value) VALUES (?, ?, ?, ?, ?)',
      [newId, sub_activity_id, name, unit || null, target_value || null]
    );
    writeLog(req, 'CREATE', 'kpi_items', newId, name);
    res.json({ success: true, id: newId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.put('/kpikorat/api/admin/kpi-items/:id', async (req, res) => {
  try {
    const { sub_activity_id, name, unit, target_value } = req.body;
    await db.query(
      'UPDATE kpi_items SET sub_activity_id=?, name=?, unit=?, target_value=? WHERE id=?',
      [sub_activity_id, name, unit || null, target_value || null, req.params.id]
    );
    writeLog(req, 'UPDATE', 'kpi_items', +req.params.id, name);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.delete('/kpikorat/api/admin/kpi-items/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM kpi_items WHERE id=?', [req.params.id]);
    writeLog(req, 'DELETE', 'kpi_items', +req.params.id);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});

// ============================================================
// USERS MANAGEMENT CRUD
// ============================================================

app.get('/kpikorat/api/admin/users-all', async (_req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, hospital_name, amphoe_name, role, hospcode, created_at, COALESCE(status,1) AS status FROM users ORDER BY amphoe_name, hospital_name'
    );
    res.json({ success: true, data: rows });
  } catch (e) { console.error(e);
 res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});

// Toggle user status
app.patch('/kpikorat/api/admin/users/:id/status', async (req, res) => {
  try {
    const newStatus = req.body.status ? 1 : 0;
    await db.query('UPDATE users SET status=? WHERE id=?', [newStatus, req.params.id]);
    writeLog(req, 'UPDATE', 'users', +req.params.id, `เปลี่ยนสถานะเป็น ${newStatus ? 'เปิด' : 'ปิด'}`);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.post('/kpikorat/api/admin/users', async (req, res) => {
  try {
    const { username, password, hospital_name, amphoe_name, role, hospcode } = req.body;
    const safeRole = ['admin', 'user'].includes(role) ? role : 'user';
    const [r] = await db.query(
      'INSERT INTO users (username, password_hash, hospital_name, amphoe_name, role, hospcode) VALUES (?, SHA2(?,256), ?, ?, ?, ?)',
      [username, password, hospital_name, amphoe_name, safeRole, hospcode || null]
    );
    writeLog(req, 'CREATE', 'users', r.insertId, `สร้างผู้ใช้ ${username}`);
    res.json({ success: true, id: r.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.put('/kpikorat/api/admin/users/:id', async (req, res) => {
  try {
    const { username, hospital_name, amphoe_name, role, hospcode, password } = req.body;
    const safeRole = ['admin', 'user'].includes(role) ? role : 'user';
    if (password) {
      await db.query(
        'UPDATE users SET username=?, hospital_name=?, amphoe_name=?, role=?, hospcode=?, password_hash=SHA2(?,256) WHERE id=?',
        [username, hospital_name, amphoe_name, safeRole, hospcode || null, password, req.params.id]
      );
    } else {
      await db.query(
        'UPDATE users SET username=?, hospital_name=?, amphoe_name=?, role=?, hospcode=? WHERE id=?',
        [username, hospital_name, amphoe_name, safeRole, hospcode || null, req.params.id]
      );
    }
    writeLog(req, 'UPDATE', 'users', +req.params.id, `แก้ไขผู้ใช้ ${username}`);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});
app.delete('/kpikorat/api/admin/users/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id=?', [req.params.id]);
    writeLog(req, 'DELETE', 'users', +req.params.id, `ลบผู้ใช้ id=${req.params.id}`);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); }
});

// ─── Export Admin Report → Excel ─────────────────────────────────────────────
app.get('/kpikorat/api/admin/report-excel', requireAdmin, async (req, res) => {
  const fy   = validFiscalYear(req.query.fiscalYear);
  if (!fy) return res.status(400).json({ error: 'ปีงบประมาณไม่ถูกต้อง' });
  const { amphoe, issueId, itemId } = req.query;

  try {
    let baseSql = `
      FROM kpi_records r
      JOIN users u ON r.user_id = u.id
      JOIN kpi_items it ON r.kpi_id = it.id
      JOIN kpi_sub_activities s ON it.sub_activity_id = s.id
      JOIN kpi_main_indicators m ON s.main_ind_id = m.id
      JOIN kpi_issues i ON m.issue_id = i.id
      WHERE r.fiscal_year = ? AND u.role != 'admin'
    `;
    const params = [fy];
    if (amphoe && amphoe !== 'ทั้งหมด') { baseSql += ' AND u.amphoe_name = ?'; params.push(amphoe); }
    if (issueId && issueId !== 'all')   { baseSql += ' AND i.id = ?';          params.push(issueId); }
    if (itemId  && itemId  !== 'all')   { baseSql += ' AND it.id = ?';         params.push(itemId); }

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
      ['รหัส', 'โรงพยาบาล', 'อำเภอ', 'ปีงบ', 'ประเด็น', 'ตัวชี้วัดหลัก', 'กิจกรรมย่อย', 'รายการ', 'หน่วย', 'เป้าหมาย', 'ผลงาน', '%'],
      ...rows.map(r => [
        r.hospcode, r.hospital_name, r.amphoe_name, r.fiscal_year,
        r.issue_name, r.main_name, r.sub_name, r.item_name, r.unit,
        r.target, r.result,
        r.target > 0 ? Math.round((r.result / r.target) * 10000) / 100 : 0
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [8,30,15,8,30,30,30,40,8,10,10,8].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'รายงาน KPI');

    writeLog(req, 'EXPORT_REPORT', 'kpi_records', null, `ส่งออกรายงาน Excel ปี ${fy}`);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="kpi_report_${fy}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    console.error('Report Excel error:', e);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// ─── Change Password (ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง) ─────────────────────────
app.post('/kpikorat/api/me/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'กรุณากรอกรหัสผ่านให้ครบถ้วน' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  try {
    const [rows] = await db.query(
      'SELECT id FROM users WHERE id = ? AND password_hash = SHA2(?, 256)',
      [req.user.id, currentPassword]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }
    await db.query(
      'UPDATE users SET password_hash = SHA2(?, 256) WHERE id = ?',
      [newPassword, req.user.id]
    );
    writeLog(req, 'CHANGE_PASSWORD', 'users', req.user.id, 'เปลี่ยนรหัสผ่านตัวเอง');
    res.json({ success: true });
  } catch (e) {
    console.error('Change password error:', e);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// ─── Audit Logs (Admin เท่านั้น) ──────────────────────────────────────────────
app.get('/kpikorat/api/admin/audit-logs', requireAdmin, async (req, res) => {
  const page  = validPage(req.query.page);
  const limit = Math.min(100, validLimit(req.query.limit));
  const offset = (page - 1) * limit;
  try {
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM system_logs');
    const [rows] = await db.query(
      'SELECT * FROM system_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    res.json({ success: true, data: rows, total, page, limit });
  } catch (e) {
    console.error('Audit logs error:', e);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// ─── Auto-create system_logs table if not exists ─────────────────────────────
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
    console.log('✅ system_logs table ready');
  } catch (e) {
    console.error('system_logs table error:', e.message);
  }
})();

const PORT = process.env.PORT || 8809;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
