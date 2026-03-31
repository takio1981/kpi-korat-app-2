-- Migration V4: kpi_main_records
-- ตารางบันทึกผลงานระดับตัวชี้วัดหลัก (kpi_main_indicators)
-- บันทึกโดย admin_cup (ระดับอำเภอ) หรือ admin_ssj (ระดับจังหวัด)
-- ไม่เกี่ยวข้องกับ kpi_items, kpi_records, hospcode

CREATE TABLE IF NOT EXISTS kpi_main_records (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  main_ind_id   INT NOT NULL COMMENT 'FK → kpi_main_indicators.id',
  fiscal_year   INT NOT NULL COMMENT 'ปีงบประมาณ (พ.ศ.) เช่น 2569',
  report_month  INT NOT NULL DEFAULT 0 COMMENT '0=เป้าหมาย, 1-12=เดือน',
  report_year_ad INT NOT NULL COMMENT 'ปี ค.ศ.',
  kpi_value     DECIMAL(15,2) NOT NULL DEFAULT 0,
  amphoe_name   VARCHAR(100) DEFAULT NULL COMMENT 'ชื่ออำเภอ (NULL=ระดับจังหวัด)',
  recorded_by   INT DEFAULT NULL COMMENT 'FK → users.id ผู้บันทึก',
  recorded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_main_records_ind FOREIGN KEY (main_ind_id)
    REFERENCES kpi_main_indicators(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_main_records_user FOREIGN KEY (recorded_by)
    REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,

  UNIQUE KEY uq_main_record (main_ind_id, fiscal_year, report_month, report_year_ad, amphoe_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indexes for common queries
CREATE INDEX idx_main_records_fy ON kpi_main_records (fiscal_year);
CREATE INDEX idx_main_records_fy_ind ON kpi_main_records (fiscal_year, main_ind_id);
CREATE INDEX idx_main_records_amphoe ON kpi_main_records (amphoe_name);
