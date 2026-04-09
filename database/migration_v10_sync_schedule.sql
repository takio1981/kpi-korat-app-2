-- Migration V10: เพิ่มฟิลด์ตั้งเวลา sync แบบใหม่ (ใช้งานง่าย)

ALTER TABLE remote_sync_config
  ADD COLUMN schedule_type VARCHAR(20) DEFAULT 'interval' COMMENT 'interval | daily' AFTER schedule_cron,
  ADD COLUMN interval_value INT DEFAULT 30 COMMENT 'จำนวน' AFTER schedule_type,
  ADD COLUMN interval_unit VARCHAR(10) DEFAULT 'minute' COMMENT 'minute | hour' AFTER interval_value,
  ADD COLUMN daily_time VARCHAR(5) DEFAULT '12:00' COMMENT 'HH:mm' AFTER interval_unit,
  ADD COLUMN start_date DATE DEFAULT NULL COMMENT 'วันเริ่มต้น sync' AFTER daily_time,
  ADD COLUMN end_date DATE DEFAULT NULL COMMENT 'วันสิ้นสุด sync' AFTER start_date;
