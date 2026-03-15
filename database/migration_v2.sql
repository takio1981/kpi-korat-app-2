-- ============================================================
-- Korat KPI App — Migration v2
-- วัตถุประสงค์: เพิ่ม system_logs, FK constraints, Indexes
-- รันครั้งเดียว — ปลอดภัยเพราะใช้ IF NOT EXISTS / IF EXISTS
-- ============================================================

-- ─── 1. สร้างตาราง system_logs ──────────────────────────────
CREATE TABLE IF NOT EXISTS system_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT,
  username     VARCHAR(100),
  role         VARCHAR(20),
  action       VARCHAR(50)   COMMENT 'CREATE | UPDATE | DELETE | IMPORT | EXPORT | CHANGE_PASSWORD',
  entity_type  VARCHAR(50)   COMMENT 'ตารางที่ถูกกระทำ เช่น users, kpi_items',
  entity_id    INT,
  detail       TEXT,
  ip_address   VARCHAR(45),
  created_at   DATETIME DEFAULT NOW(),
  INDEX idx_created_at (created_at),
  INDEX idx_user_id    (user_id),
  INDEX idx_action     (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Audit log สำหรับทุก admin action';

-- ─── 2. แก้ hospcode ใน users ให้ตรงกับ kpi_records ────────
-- users.hospcode เป็น varchar(255) แต่ kpi_records.hospcode เป็น varchar(5)
-- ปรับ users ให้เป็น varchar(10) เพื่อรองรับทั้ง 5 หลัก + buffer
ALTER TABLE users
  MODIFY COLUMN hospcode VARCHAR(10) NULL COMMENT 'รหัสหน่วยบริการ 5 หลัก';

-- ─── 3. เพิ่ม Indexes บน kpi_records ─────────────────────────
-- Index สำหรับ query ตามผู้ใช้
ALTER TABLE kpi_records
  ADD INDEX IF NOT EXISTS idx_user_id      (user_id),
  ADD INDEX IF NOT EXISTS idx_hospcode     (hospcode),
  ADD INDEX IF NOT EXISTS idx_year_month   (fiscal_year, report_month),
  ADD INDEX IF NOT EXISTS idx_kpi_year     (kpi_id, fiscal_year);

-- ─── 4. FK Constraints บน kpi_records ────────────────────────
-- เพิ่ม FK เฉพาะถ้ายังไม่มี (ตรวจสอบก่อน)
-- NOTE: ต้องทำ data cleanup ก่อนถ้ามี orphan records

-- ลบ orphan kpi_records ที่ไม่มี user
DELETE FROM kpi_records WHERE user_id NOT IN (SELECT id FROM users);

-- ลบ orphan kpi_records ที่ไม่มี kpi_item
DELETE FROM kpi_records WHERE kpi_id NOT IN (SELECT id FROM kpi_items);

-- เพิ่ม FK (ถ้า FK ชื่อนี้ยังไม่มี)
SET @fk_user := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'kpi_records'
    AND CONSTRAINT_NAME = 'fk_kpi_records_user'
);

SET @fk_kpi := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'kpi_records'
    AND CONSTRAINT_NAME = 'fk_kpi_records_kpi'
);

-- เพิ่ม FK user_id → users.id (ON DELETE CASCADE)
SET @sql_user = IF(@fk_user = 0,
  'ALTER TABLE kpi_records ADD CONSTRAINT fk_kpi_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT "fk_kpi_records_user already exists"'
);
PREPARE stmt FROM @sql_user;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- เพิ่ม FK kpi_id → kpi_items.id (ON DELETE RESTRICT)
SET @sql_kpi = IF(@fk_kpi = 0,
  'ALTER TABLE kpi_records ADD CONSTRAINT fk_kpi_records_kpi FOREIGN KEY (kpi_id) REFERENCES kpi_items(id) ON DELETE RESTRICT',
  'SELECT "fk_kpi_records_kpi already exists"'
);
PREPARE stmt FROM @sql_kpi;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 5. เพิ่ม status column ถ้ายังไม่มี ─────────────────────
ALTER TABLE users
  MODIFY COLUMN status TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1=เปิด, 0=ปิด';

-- ─── 6. ตรวจสอบผลลัพธ์ ─────────────────────────────────────
SELECT 'Migration v2 completed successfully!' AS result;
SHOW INDEX FROM kpi_records WHERE Key_name LIKE 'idx_%';
SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_records';
