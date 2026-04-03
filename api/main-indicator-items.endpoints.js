/**
 * Main Indicator Items API Endpoints
 * API สำหรับจัดการระดับตัวชี้วัดหลักแบบแสดง 31 รายการกับการตั้งค่า
 */

// ====== KPI MAIN RECORDS ITEMS (ผลงานตัวชี้วัดหลัก + 31 Items) ======

// GET: ดึงข้อมูล main records ที่เป็น item-level (แสดง 31 รายการ)
// /kpikorat/api/main-records-items?fiscalYear=2569&amphoe_name=นครราชสีมา&main_ind_id=1
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
// /kpikorat/api/main-indicator-config?main_ind_id=1
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
// /kpikorat/api/main-indicator-items?main_ind_id=1
app.get("/kpikorat/api/main-indicator-items", async (req, res) => {
  try {
    const mainIndId = parseInt(req.query.main_ind_id);
    if (!mainIndId) {
      return res.status(400).json({ error: "ต้องระบุ main_ind_id" });
    }

    // ดึง items ที่อยู่ใน sub_activities ของ main indicator นี้
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

// POST: Batch save main record items (ผลงาน 31 items ของ main indicator)
// Request: { fiscalYear, amphoe_name, main_ind_id, changes: [{ item_id, month, value, is_visible }] }
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

        // คำนวณปี ค.ศ.
        const adYear = month >= 10 ? fy - 544 : fy - 543;

        if (val === null) {
          // ลบข้อมูล
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
          // Insert/Update
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

      // บันทึก audit logs
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
// Request: { main_ind_id, item_id, agenda_field, field_index, sort_order, is_hidden, display_name }
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
// Request: { main_ind_id, items: [{ item_id, is_visible }] }
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

// GET: ดึง summary ของ main indicator records (แสดงเฉพาะ visible items)
// /kpikorat/api/main-indicator-summary?main_ind_id=1&fiscal_year=2569
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
// /kpikorat/api/main-indicator-config/:configId
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
