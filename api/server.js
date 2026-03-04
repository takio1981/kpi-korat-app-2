const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const compression = require("compression"); // เพิ่ม compression สำหรบ gzip

const app = express();
app.use(compression()); // เปิดใช้งาน gzip บีบอัดข้อมูล
app.use(cors());
app.use(express.json());

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
    console.log("⚡ Calling Dashboard Summary API (Updated Version)"); // เช็คว่าเรียกตัวใหม่จริงไหม
    const { fiscal_year, district_id } = req.query;

    // ใช้ SQL นี้เพื่อดึงชื่อตัวชี้วัดตั้งต้นก่อน (Main Indicators) แล้วค่อยเอาผลงานมาแปะ
    const sql = `
            SELECT
                iss.name AS issue_name,             -- ชื่อประเด็น
                ind.name AS kpi_name,               -- ชื่อตัวชี้วัด

                -- คำนวณผลรวม (ถ้าไม่มีข้อมูล ให้เป็น 0)
                COALESCE(SUM(CASE WHEN r.report_month = 0 THEN r.kpi_value ELSE 0 END), 0) AS total_target,
                COALESCE(SUM(CASE WHEN r.report_month <> 0 THEN r.kpi_value ELSE 0 END), 0) AS total_result

            FROM kpi_main_indicators ind
            JOIN kpi_issues iss ON ind.issue_id = iss.id
            JOIN kpi_items it ON it.id = ind.id

            -- 🟢 เชื่อมกับข้อมูลผลงาน (ใช้ LEFT JOIN เพื่อให้ตัวชี้วัดที่ไม่มียอด ยังโชว์ชื่ออยู่)
            LEFT JOIN (
                SELECT rec.kpi_id, rec.kpi_value, rec.report_month
                FROM kpi_records rec
                LEFT JOIN users u ON rec.user_id = u.id
                WHERE rec.fiscal_year = ?
                AND (u.amphoe_name = ? OR ? = 'all' OR ? IS NULL)
            ) r ON it.id = r.kpi_id

            GROUP BY iss.id, ind.id, iss.name, ind.name
            ORDER BY iss.id ASC, ind.id ASC
        `;

    // ส่ง Parameter: [ปี, อำเภอ, อำเภอ(เช็ค all), อำเภอ(เผื่อเป็น null)]
    const [rows] = await db.execute(sql, [
      fiscal_year || "2569",
      district_id || "all",
      district_id || "all",
      district_id || "all",
    ]);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Dashboard Summary Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- 1. API Login (ตรงกับ apiLogin ใน code.gs) ---
app.post("/kpikorat/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    // ใช้ SHA2(?, 256) ตามไฟล์ code.gs
    const sql = `SELECT id, hospital_name, amphoe_name, role
                     FROM users
                     WHERE username = ? AND password_hash = SHA2(?, 256)`;
    const [rows] = await db.query(sql, [username, password]);

    if (rows.length > 0) res.json({ success: true, user: rows[0] });
    else
      res.status(401).json({
        success: false,
        message: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง",
      });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// --- 3. API ดึงข้อมูลคะแนน (GetData) ---
app.get("/kpikorat/api/kpi-data", async (req, res) => {
  const { userId, fiscalYear } = req.query;
  try {
    const [rows] = await db.query(
      "SELECT kpi_id, report_month, kpi_value FROM kpi_records WHERE user_id = ? AND fiscal_year = ?",
      [userId, fiscalYear],
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 4. API บันทึกข้อมูล (SaveData) ---
app.post("/kpikorat/api/kpi-data/batch", async (req, res) => {
  const { userId, fiscalYear, changes } = req.body;
  const conn = await pool.promise().getConnection();
  try {
    await conn.beginTransaction();

    // 1. ดึง Hospcode ของ User นี้มาจากตาราง users ก่อน
    const [users] = await conn.query(
      "SELECT hospcode FROM users WHERE id = ?",
      [userId],
    );
    const userHospcode = users.length > 0 ? users[0].hospcode : null;

    // แยกข้อมูลที่จะ Insert/Update ออกจากข้อมูลที่จะ Delete
    const toInsert = [];
    const toDeleteIds = [];

    for (let item of changes) {
      if (item.value !== null && item.value !== "") {
        let yearAD = fiscalYear - 543;
        if (item.month >= 10) yearAD = fiscalYear - 544;
        toInsert.push([
          userId,
          userHospcode,
          fiscalYear,
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// --- 8. API รายงานละเอียด (Detailed Report) พร้อม Pagination ---
app.get("/kpikorat/api/admin/report", async (req, res) => {
  const { fiscalYear, amphoe, issueId, itemId, page, limit } = req.query;

  const offset = (page - 1) * limit;
  const pLimit = parseInt(limit);

  try {
    // สร้าง Base SQL (Join ตารางให้ครบ)
    let baseSql = `
            FROM kpi_records r
            JOIN users u ON r.user_id = u.id
            JOIN kpi_items it ON r.kpi_id = it.id
            JOIN kpi_sub_activities s ON it.sub_activity_id = s.id
            JOIN kpi_main_indicators m ON s.main_ind_id = m.id
            JOIN kpi_issues i ON m.issue_id = i.id
            WHERE r.fiscal_year = ? AND u.role != 'admin'
        `;

    const params = [fiscalYear];

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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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

const PORT = process.env.PORT || 8809;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
