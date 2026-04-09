-- Migration V9: Remote sync configuration + history
-- เก็บค่า config ของ remote MySQL (host, user, password, db)
-- และเก็บประวัติการ sync (หรือ schedule)

CREATE TABLE IF NOT EXISTS remote_sync_config (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL DEFAULT 'default',
  host          VARCHAR(150) NOT NULL,
  port          INT NOT NULL DEFAULT 3306,
  username      VARCHAR(100) NOT NULL,
  password_enc  TEXT NOT NULL COMMENT 'รหัสผ่าน (ควร encrypt ก่อนเก็บ — ตอนนี้เก็บเป็น plaintext)',
  database_name VARCHAR(100) NOT NULL,
  enabled       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=เปิด scheduled sync, 0=ปิด',
  schedule_cron VARCHAR(50) DEFAULT NULL COMMENT 'cron pattern เช่น "0 */6 * * *" (ทุก 6 ชม.)',
  last_sync_at  DATETIME DEFAULT NULL,
  last_status   VARCHAR(20) DEFAULT NULL COMMENT 'success | failed',
  last_message  TEXT DEFAULT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS remote_sync_history (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  config_id       INT NOT NULL,
  byear           INT DEFAULT NULL,
  trigger_type    VARCHAR(20) DEFAULT 'manual' COMMENT 'manual | scheduled',
  status          VARCHAR(20) NOT NULL COMMENT 'success | failed | partial',
  tables_synced   INT DEFAULT 0,
  rows_synced     INT DEFAULT 0,
  error_count     INT DEFAULT 0,
  message         TEXT DEFAULT NULL,
  triggered_by    INT DEFAULT NULL COMMENT 'FK → users.id',
  started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME DEFAULT NULL,
  KEY idx_config (config_id),
  KEY idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ค่า default (ใส่ค่าจริงผ่าน UI)
INSERT IGNORE INTO remote_sync_config (name, host, port, username, password_enc, database_name)
VALUES ('default', '192.168.0.0', 3306, 'user', '', 'central_kpi');
