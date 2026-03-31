-- Migration V5: เพิ่ม role ใหม่ + dep_id ใน users
-- Roles: user, admin (legacy), admin_cup (อำเภอ), admin_ssj (กลุ่มงาน สสจ.), super_admin (จัดการทุกอย่าง)
-- ใช้ตาราง departments ที่มีอยู่แล้ว (id, dept_code, dept_name, is_active)

-- 1. เปลี่ยน role column จาก ENUM('admin','user') เป็น VARCHAR เพื่อรองรับ role ใหม่
ALTER TABLE users MODIFY COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user';

-- 2. เพิ่ม dep_id column (FK → departments.id)
ALTER TABLE users ADD COLUMN dep_id INT DEFAULT NULL COMMENT 'FK → departments.id กลุ่มงาน' AFTER role;
ALTER TABLE users ADD CONSTRAINT fk_users_dep FOREIGN KEY (dep_id) REFERENCES departments(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 3. Migrate admin → super_admin (ถ้าต้องการ)
-- UPDATE users SET role = 'super_admin' WHERE role = 'admin';

-- 4. Indexes
CREATE INDEX idx_users_dep_id ON users (dep_id);
-- CREATE INDEX idx_users_role ON users (role);  -- อาจมีอยู่แล้วจาก migration_v3
