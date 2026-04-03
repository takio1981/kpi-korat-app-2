-- Migration V3: Scalability & Security Improvements
-- วันที่: 2026-03-16
-- รายละเอียด: เพิ่ม compound indexes, password_version column

-- ─── 1. เพิ่ม password_version สำหรับ bcrypt migration ──────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_version TINYINT NOT NULL DEFAULT 0
  COMMENT '0=SHA2 legacy, 1=bcrypt';

-- ─── 2. Compound Indexes สำหรับ kpi_records ─────────────────────────────────────
-- Query หลัก: filter fiscal_year + join user_id + group by kpi_id, report_month
CREATE INDEX IF NOT EXISTS idx_records_fy_user_kpi_month
  ON kpi_records (fiscal_year, user_id, kpi_id, report_month);

-- Provincial summary: filter fiscal_year + kpi_id + report_month
CREATE INDEX IF NOT EXISTS idx_records_fy_kpi_month
  ON kpi_records (fiscal_year, kpi_id, report_month);

-- ─── 3. Indexes สำหรับ users table ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_hospcode ON users (hospcode);
CREATE INDEX IF NOT EXISTS idx_users_amphoe ON users (amphoe_name);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- ─── 4. Index สำหรับ system_logs (ป้องกัน full table scan ตอน COUNT) ────────────
CREATE INDEX IF NOT EXISTS idx_syslog_action ON system_logs (action);
