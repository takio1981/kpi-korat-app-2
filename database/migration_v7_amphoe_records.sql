-- Migration V7: kpi_amphoe_records
-- ตารางบันทึกผลงาน KPI items ระดับอำเภอ (admin_cup/admin_ssj แก้ไขในโหมดดูข้อมูล อำเภอ)
-- ไม่ผูก user_id เพราะเป็นข้อมูลรวมระดับอำเภอ

CREATE TABLE IF NOT EXISTS kpi_amphoe_records (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  amphoe_name     VARCHAR(100) NOT NULL,
  kpi_id          INT NOT NULL COMMENT 'FK → kpi_items.id',
  fiscal_year     INT NOT NULL,
  report_month    INT NOT NULL DEFAULT 0 COMMENT '0=เป้าหมาย, 1-12=เดือน',
  report_year_ad  INT NOT NULL,
  kpi_value       DECIMAL(15,2) NOT NULL DEFAULT 0,
  recorded_by     INT DEFAULT NULL COMMENT 'FK → users.id (admin ผู้บันทึก)',
  recorded_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_amphoe_rec_kpi FOREIGN KEY (kpi_id) REFERENCES kpi_items(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_amphoe_rec_user FOREIGN KEY (recorded_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,

  UNIQUE KEY uq_amphoe_record (amphoe_name, kpi_id, fiscal_year, report_month, report_year_ad),
  KEY idx_amphoe_fy (fiscal_year, amphoe_name),
  KEY idx_amphoe_kpi (kpi_id, fiscal_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
