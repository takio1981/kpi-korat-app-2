import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

interface Link {
  label: string;
  icon: string;
  route?: string;
  externalUrl?: string;
}

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
  extraLogo?: string; // โลโก้เพิ่มเติม (แสดงคู่กับ MOPH logo)
  links?: Link[]; // Links ภายในการ์ด
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.html',
})
export class HomeComponent {
  systems: SystemCard[] = [
    {
      icon: 'fa-chart-bar',
      title: 'ระบบประเมินติดตามผลการดำเนินงานด้านสุขภาพ',
      subtitle: 'KHD Dashboard',
      description:
        'ระบบประเมินติดตามผลการดำเนินงานด้านสุขภาพของจังหวัดนครราชสีมา KHD',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      externalUrl: 'https://apikorat.moph.go.th/home/dashboard',
      badge: 'KHD',
    },
    {
      icon: 'fa-chart-line',
      title: 'ระบบบันทึกตัวชี้วัด 1+11',
      subtitle: 'KPI Recording System',
      description:
        'บันทึกและติดตามตัวชี้วัด 1+11 ระดับอำเภอ สำหรับเจ้าหน้าที่สาธารณสุข จังหวัดนครราชสีมา',
      color: 'text-teal-600',
      bgColor: 'bg-teal-50',
      borderColor: 'border-teal-200',
      route: '/login',
      badge: 'จังหวัด',
      extraLogo: 'logonma.png',
      links: [
        {
          label: 'คุณสมบัติของระบบ',
          icon: 'fa-star',
          route: '/features',
        },
        {
          label: 'คู่มือการใช้งาน',
          icon: 'fa-book-open',
          route: '/user-guide',
        },
      ],
    },
    {
      icon: 'fa-heartbeat',
      title: 'ระบบบันทึกผลงาน KPI ด้านสุขภาพ',
      subtitle: 'Health KPI System (MOPH)',
      description:
        'ระบบบันทึกผลงาน KPI ด้านสุขภาพ กระทรวงสาธารณสุข สำหรับหน่วยบริการในจังหวัดนครราชสีมา',
      color: 'text-rose-600',
      bgColor: 'bg-rose-50',
      borderColor: 'border-rose-200',
      externalUrl: 'https://apikorat.moph.go.th/khupskpi/',
      badge: 'MOPH',
    },
  ];

  constructor(private router: Router) {}

  onCardClick(system: SystemCard) {
    if (system.externalUrl) {
      window.open(system.externalUrl, '_blank');
    } else if (system.route) {
      this.router.navigate([system.route]);
    }
  }

  onLinkClick(link: Link, event: Event) {
    event.stopPropagation();
    if (link.externalUrl) {
      window.open(link.externalUrl, '_blank');
    } else if (link.route) {
      this.router.navigate([link.route]);
    }
  }

  // เก็บไว้สำหรับปุ่ม login ใน header
  goToLogin(route: string) {
    this.router.navigate([route]);
  }
}
