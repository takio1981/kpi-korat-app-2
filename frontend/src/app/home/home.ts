import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

interface SystemCard {
  icon: string;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  route?: string;
  externalUrl?: string;
  badge?: string;
  extraLogo?: string;  // โลโก้เพิ่มเติม (แสดงคู่กับ MOPH logo)
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.html'
})
export class HomeComponent {
  systems: SystemCard[] = [
    {
      icon: 'fa-chart-line',
      title: 'ระบบบันทึกตัวชี้วัด 11+1',
      subtitle: 'KPI Recording System',
      description: 'บันทึกและติดตามตัวชี้วัด 11+1 ระดับอำเภอ สำหรับเจ้าหน้าที่สาธารณสุข จังหวัดนครราชสีมา',
      color: 'text-teal-600',
      bgColor: 'bg-teal-50',
      borderColor: 'border-teal-200',
      route: '/login',
      badge: 'จังหวัด',
      extraLogo: 'logonma.png'
    },
    {
      icon: 'fa-heartbeat',
      title: 'ระบบบันทึกผลงาน KPI ด้านสุขภาพ',
      subtitle: 'Health KPI System (MOPH)',
      description: 'ระบบบันทึกผลงาน KPI ด้านสุขภาพ กระทรวงสาธารณสุข สำหรับหน่วยบริการในจังหวัดนครราชสีมา',
      color: 'text-rose-600',
      bgColor: 'bg-rose-50',
      borderColor: 'border-rose-200',
      externalUrl: 'https://apikorat.moph.go.th/khupskpi/',
      badge: 'MOPH'
    }
  ];

  constructor(private router: Router) {}

  onCardClick(system: SystemCard) {
    if (system.externalUrl) {
      window.open(system.externalUrl, '_blank');
    } else if (system.route) {
      this.router.navigate([system.route]);
    }
  }

  // เก็บไว้สำหรับปุ่ม login ใน header
  goToLogin(route: string) {
    this.router.navigate([route]);
  }
}
