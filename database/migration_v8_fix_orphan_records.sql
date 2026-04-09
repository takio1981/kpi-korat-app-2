-- Migration V8: แก้ไข records ที่ผูกกับ user ผิด (super_admin/admin_ssj)
-- Records เหล่านี้บันทึกผิดเพราะ saveBatch เก่าใช้ req.user.id แทนที่จะใช้ targetUserId
--
-- กลยุทธ์:
-- 1. ตรวจสอบ records ที่อยู่ภายใต้ user ที่ไม่มี amphoe_name (super_admin/admin_ssj โดยทั่วไป)
-- 2. ถ้ามี hospcode → match กับ users.hospcode → ย้ายไปยัง user_id ที่ถูกต้อง
-- 3. ถ้าไม่มี hospcode (ข้อมูลกำพร้าจริงๆ) → list ออกมา (ไม่ลบอัตโนมัติ ป้องกันสูญหาย)

-- ============================================================
-- STEP 1: ดู records ที่ผูกผิด (run ก่อนเพื่อตรวจสอบ)
-- ============================================================
SELECT
  r.id, r.user_id, r.hospcode, r.kpi_id, r.report_month, r.kpi_value,
  u.username AS owner_username, u.role AS owner_role, u.amphoe_name AS owner_amphoe
FROM kpi_records r
JOIN users u ON r.user_id = u.id
WHERE u.amphoe_name IS NULL OR u.amphoe_name = ''
ORDER BY r.id;

-- ============================================================
-- STEP 2: ย้าย records ที่มี hospcode → ไปยัง user ที่ตรงกับ hospcode
-- (ทำเฉพาะกรณีที่ records มี hospcode ระบุไว้)
-- ============================================================
UPDATE kpi_records r
JOIN users u_owner ON r.user_id = u_owner.id
JOIN users u_target ON r.hospcode = u_target.hospcode
SET r.user_id = u_target.id
WHERE (u_owner.amphoe_name IS NULL OR u_owner.amphoe_name = '')
  AND r.hospcode IS NOT NULL AND r.hospcode <> ''
  AND u_target.amphoe_name IS NOT NULL
  AND u_target.id != r.user_id;

-- ============================================================
-- STEP 3: ตรวจ records ที่ยังกำพร้า (ไม่มี hospcode หรือไม่ match)
-- รันเพื่อดูว่ามีอะไรเหลือ — ไม่ลบอัตโนมัติ
-- ============================================================
SELECT
  r.id, r.user_id, r.hospcode, r.kpi_id, r.report_month, r.kpi_value, r.recorded_at,
  u.username AS owner_username, u.role AS owner_role
FROM kpi_records r
JOIN users u ON r.user_id = u.id
WHERE u.amphoe_name IS NULL OR u.amphoe_name = ''
ORDER BY r.id;

-- ============================================================
-- STEP 4 (Optional - manual): ลบ records กำพร้าที่เหลือ
-- ⚠️ คอมเมนต์ไว้เพื่อความปลอดภัย — uncomment เฉพาะเมื่อตรวจสอบแล้ว
-- ============================================================
-- DELETE r FROM kpi_records r
-- JOIN users u ON r.user_id = u.id
-- WHERE u.amphoe_name IS NULL OR u.amphoe_name = '';
