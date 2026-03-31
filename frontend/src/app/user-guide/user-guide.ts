import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-user-guide',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './user-guide.html'
})
export class UserGuideComponent {
  activeSection = 'overview';

  sections = [
    { id: 'overview', label: 'ภาพรวมระบบ', icon: 'fa-home' },
    { id: 'login', label: 'การเข้าสู่ระบบ', icon: 'fa-sign-in-alt' },
    { id: 'record', label: 'บันทึกข้อมูล KPI', icon: 'fa-edit' },
    { id: 'import', label: 'นำเข้าข้อมูล Excel', icon: 'fa-file-import' },
    { id: 'summary', label: 'ดูสรุปผลงาน', icon: 'fa-chart-pie' },
    { id: 'provincial', label: 'สรุปภาพรวมจังหวัด', icon: 'fa-map-marked-alt' },
    { id: 'agenda', label: 'รายงาน 1+11', icon: 'fa-file-alt' },
    { id: 'main-ind', label: 'บันทึกตัวชี้วัดหลัก', icon: 'fa-clipboard-check' },
    { id: 'admin-dashboard', label: 'Admin Dashboard', icon: 'fa-tachometer-alt' },
    { id: 'edit-hospital', label: 'แก้ไขข้อมูลหน่วยบริการ', icon: 'fa-hospital' },
    { id: 'export', label: 'ส่งออกข้อมูล', icon: 'fa-file-export' },
    { id: 'kpi-management', label: 'จัดการระบบ (Super Admin)', icon: 'fa-cogs' },
    { id: 'user-management', label: 'จัดการผู้ใช้งาน', icon: 'fa-users' },
    { id: 'roles', label: 'ระบบสิทธิ์', icon: 'fa-user-shield' },
    { id: 'password', label: 'เปลี่ยนรหัสผ่าน', icon: 'fa-key' },
    { id: 'faq', label: 'คำถามที่พบบ่อย', icon: 'fa-question-circle' },
  ];

  scrollTo(id: string) {
    this.activeSection = id;
    const el = document.getElementById('section-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
