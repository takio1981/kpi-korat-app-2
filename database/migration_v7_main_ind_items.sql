-- Migration V7: Enhanced Main Indicator Recording with 31 Items
-- เพิ่มความสามารถในการบันทึกตัวชี้วัดหลักแบบแสดงรายการ 31 รายการ
-- พร้อมการตั้งค่าว่าข้อไหนแสดงในช่องไหน

-- 1. Extend kpi_main_records to support multiple items
-- เพิ่มคอลัมน์ item_id เพื่อเก็บค่า item-level สำหรับ main indicators
ALTER TABLE IF EXISTS kpi_main_records
ADD COLUMN `item_id` INT DEFAULT NULL COMMENT 'FK → kpi_items.id (NULL = aggregate value)' AFTER `main_ind_id`,
ADD COLUMN `is_visible` TINYINT DEFAULT 1 COMMENT 'ใช้กำหนดว่า item นี้แสดงได้ 0=ซ่อน 1=แสดง' AFTER `kpi_value`;

-- ปรับปรุง UNIQUE KEY เพื่อรองรับ item_id
ALTER TABLE IF EXISTS kpi_main_records
DROP KEY IF EXISTS uq_main_record,
ADD UNIQUE KEY uq_main_record_all (main_ind_id, fiscal_year, report_month, report_year_ad, amphoe_name, item_id);

-- 2. สร้างตาราง configuration: แมประหว่าง main_indicator กับ item และ agenda-report field
CREATE TABLE IF NOT EXISTS main_indicator_item_config (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'Primary key',
  main_ind_id INT NOT NULL COMMENT 'FK → kpi_main_indicators.id',
  item_id INT NOT NULL COMMENT 'FK → kpi_items.id (หนึ่งใน 31 items)',

  -- Configuration: ข้อไหนแสดงในโพลที่ไหนของ agenda-report
  -- เช่น "target", "result", "sub_result", "custom_field" เป็นต้น
  agenda_field VARCHAR(50) DEFAULT NULL COMMENT 'agenda-report field name (e.g., "target", "result", "sub_result")',
  field_index INT DEFAULT 0 COMMENT 'ลำดับของ field (สำหรับ layout control)',

  -- Metadata
  sort_order INT DEFAULT 0 COMMENT 'ลำดับการแสดง (0=ซ่อน, >0=ลำดับแสดง)',
  is_hidden TINYINT DEFAULT 0 COMMENT 'ผู้ใช้สามารถซ่อนขึ้นด้วยเองหรือไม่ 0=เห็นได้, 1=ซ่อนไม่ได้, 2=ซ่อนเลยตั้งแต่แรก',
  display_name VARCHAR(255) DEFAULT NULL COMMENT 'ชื่อที่แสดงสำหรับ agenda-report (ถ้าแตกต่างจากชื่อ item)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_config_main_ind FOREIGN KEY (main_ind_id)
    REFERENCES kpi_main_indicators(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_config_item FOREIGN KEY (item_id)
    REFERENCES kpi_items(id) ON UPDATE CASCADE ON DELETE CASCADE,

  UNIQUE KEY uq_main_item_field (main_ind_id, item_id, agenda_field)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- สร้าง INDEX เพื่อให้ query ได้เร็ว
CREATE INDEX idx_main_ind_item_config ON main_indicator_item_config(main_ind_id, sort_order);
CREATE INDEX idx_main_ind_item_config_item ON main_indicator_item_config(item_id);

-- 3. สร้างตาราง: Main Indicator to Sub Activities Mapping
-- ใช้กำหนดว่า sub_activity ไหนเป็นส่วนของ main_indicator ไหน
CREATE TABLE IF NOT EXISTS main_indicator_sub_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  main_ind_id INT NOT NULL COMMENT 'FK → kpi_main_indicators.id',
  sub_id INT NOT NULL COMMENT 'FK → kpi_sub_activities.id',

  -- Control which sub-activities contribute to this main indicator
  include_in_record TINYINT DEFAULT 1 COMMENT '1=รวมใน main record, 0=ไม่รวม',
  sort_order INT DEFAULT 0 COMMENT 'ลำดับ',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_main_to_sub_main FOREIGN KEY (main_ind_id)
    REFERENCES kpi_main_indicators(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_main_to_sub_sub FOREIGN KEY (sub_id)
    REFERENCES kpi_sub_activities(id) ON UPDATE CASCADE ON DELETE CASCADE,

  UNIQUE KEY uq_main_sub (main_ind_id, sub_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Insert default configurations - สำหรับ main_indicator ที่มี sub_activities อยู่แล้ว
-- ดึงข้อมูลจาก kpi_sub_activities ที่มี main_ind_id
INSERT INTO main_indicator_sub_activities (main_ind_id, sub_id, include_in_record, sort_order)
SELECT DISTINCT m.id, s.id, 1, s.id
FROM kpi_main_indicators m
JOIN kpi_sub_activities s ON s.main_ind_id = m.id
ON DUPLICATE KEY UPDATE include_in_record=1;

-- 5. Create initial item configs for main indicators
-- โดยปกติ: items 2,4,5 → main_ind 1, items 11,14,12,15 → main_ind 2 เป็นต้น
-- ส่วนใหญ่จะ set aggregate value เป็นค่า "result" field
-- NOTE: คำสั่งนี้ต้องปรับตามว่าแต่ละ main_indicator ใช้ item ไหนจริงๆ

-- 6. Audit table (Optional): สำหรับ track changes
CREATE TABLE IF NOT EXISTS main_record_audit (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  main_ind_id INT NOT NULL,
  item_id INT DEFAULT NULL,
  amphoe_name VARCHAR(100) DEFAULT NULL,
  fiscal_year INT NOT NULL,
  report_month INT NOT NULL,
  old_value DECIMAL(15,2) DEFAULT NULL,
  new_value DECIMAL(15,2) DEFAULT NULL,
  changed_by INT DEFAULT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_audit_main_ind FOREIGN KEY (main_ind_id)
    REFERENCES kpi_main_indicators(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_audit_user FOREIGN KEY (changed_by)
    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_audit_main_fy ON main_record_audit(main_ind_id, fiscal_year);

-- 7. Add comment for documentation
ALTER TABLE kpi_main_records COMMENT = 'ตารางบันทึกผลงานระดับตัวชี้วัดหลัก - รองรับทั้ง aggregate value และ item-level values';
