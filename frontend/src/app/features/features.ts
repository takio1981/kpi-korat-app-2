import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './features.html'
})
export class FeaturesComponent {
  features = [
    {
      icon: 'fa-chart-line',
      title: 'บันทึกข้อมูลตัวชี้วัด KPI',
      desc: 'บันทึกผลงานตัวชี้วัด 1+11 Agenda KORAT รายเดือน แยกตามหน่วยบริการ รองรับการนำเข้าจาก Excel',
      color: 'teal'
    },
    {
      icon: 'fa-map-marked-alt',
      title: 'สรุปภาพรวมระดับจังหวัด',
      desc: 'ดูข้อมูลรวมทุกหน่วยบริการในจังหวัดนครราชสีมา แยกรายประเด็น ตัวชี้วัด กิจกรรมย่อย พร้อมกราฟแนวโน้ม',
      color: 'blue'
    },
    {
      icon: 'fa-file-alt',
      title: 'รายงาน 1+11 Agenda KORAT',
      desc: 'สร้างรายงานสรุปผลงานตามรูปแบบวาระประชุม พร้อม Export PDF สำหรับนำเสนอ',
      color: 'indigo'
    },
    {
      icon: 'fa-clipboard-check',
      title: 'บันทึกผลงานตัวชี้วัดหลัก',
      desc: 'บันทึกผลงานระดับตัวชี้วัดหลัก (Main Indicator) แยกจากข้อมูลรายหน่วยบริการ รองรับบันทึกระดับจังหวัดและรายอำเภอ',
      color: 'purple'
    },
    {
      icon: 'fa-hospital',
      title: 'แก้ไขข้อมูลหน่วยบริการ',
      desc: 'Admin สามารถแก้ไขข้อมูล KPI ของทุกหน่วยบริการได้ผ่าน Modal พร้อมระบบติดตามการเปลี่ยนแปลง',
      color: 'amber'
    },
    {
      icon: 'fa-file-import',
      title: 'นำเข้า/ส่งออกข้อมูล Excel',
      desc: 'นำเข้าข้อมูลจากไฟล์ Excel ตามรูปแบบที่กำหนด และส่งออกรายงานเป็น Excel ได้',
      color: 'green'
    },
    {
      icon: 'fa-users-cog',
      title: 'ระบบสิทธิ์ผู้ใช้งาน 4 ระดับ',
      desc: 'User (หน่วยบริการ), Admin CUP (ระดับอำเภอ), Admin สสจ. (ระดับกลุ่มงาน), Super Admin (จัดการทุกอย่าง)',
      color: 'rose'
    },
    {
      icon: 'fa-building',
      title: 'แยกกลุ่มงานตามตัวชี้วัด',
      desc: 'กำหนดกลุ่มงาน (Department) ให้แต่ละตัวชี้วัดหลัก เพื่อให้ Admin สสจ. ดูแลเฉพาะ KPI ของกลุ่มงานตนเอง',
      color: 'orange'
    },
    {
      icon: 'fa-chart-bar',
      title: 'Dashboard สรุปผลงาน',
      desc: 'แสดงภาพรวมความก้าวหน้าการบันทึกข้อมูลแต่ละหน่วยบริการ พร้อม Drill-down ดูรายละเอียด',
      color: 'cyan'
    },
    {
      icon: 'fa-shield-alt',
      title: 'ระบบความปลอดภัย',
      desc: 'JWT Authentication, Rate Limiting, Audit Log บันทึกทุกการเปลี่ยนแปลง, รองรับ bcrypt password hashing',
      color: 'gray'
    }
  ];

  roles = [
    { name: 'User', desc: 'บันทึกข้อมูล KPI เฉพาะหน่วยบริการตัวเอง', icon: 'fa-user', color: 'teal' },
    { name: 'Admin CUP', desc: 'จัดการข้อมูล KPI ทุกข้อ เฉพาะอำเภอเดียวกัน', icon: 'fa-user-tie', color: 'amber' },
    { name: 'Admin สสจ.', desc: 'จัดการ KPI เฉพาะกลุ่มงาน ได้ทุกอำเภอ', icon: 'fa-user-shield', color: 'orange' },
    { name: 'Super Admin', desc: 'จัดการได้ทุกอย่าง รวมถึงโครงสร้าง KPI และผู้ใช้งาน', icon: 'fa-crown', color: 'purple' }
  ];
}
