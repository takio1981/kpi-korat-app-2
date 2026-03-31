-- Migration V6: เพิ่ม dep_id ให้ kpi_main_indicators
-- เพื่อระบุว่าตัวชี้วัดหลักอยู่ในกลุ่มงาน/ฝ่ายใด (admin_ssj ดูแล)

ALTER TABLE kpi_main_indicators
  ADD COLUMN dep_id INT DEFAULT NULL COMMENT 'FK → departments.id กลุ่มงานที่ดูแลตัวชี้วัดนี้'
  AFTER target_label;

ALTER TABLE kpi_main_indicators
  ADD CONSTRAINT fk_main_ind_dep FOREIGN KEY (dep_id) REFERENCES departments(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX idx_main_ind_dep ON kpi_main_indicators (dep_id);
