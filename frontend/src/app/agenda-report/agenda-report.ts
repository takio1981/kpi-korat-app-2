import { Component, OnInit } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api';
import { NavbarComponent } from '../shared/navbar/navbar';

@Component({
  selector: 'app-agenda-report',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, DecimalPipe],
  templateUrl: './agenda-report.html'
})
export class AgendaReportComponent implements OnInit {
  fiscalYear = 2569;
  availableYears = [2566, 2567, 2568, 2569, 2570];
  reportData: any = null;
  isLoading = false;
  reportDate = '';

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.setReportDate();
    this.loadReport();
  }

  setReportDate() {
    const now = new Date();
    const thDay = now.getDate();
    const thMonth = ['', 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'][now.getMonth() + 1];
    const thYear = now.getFullYear() + 543;
    this.reportDate = `${thDay} ${thMonth} ${thYear}`;
  }

  loadReport() {
    this.isLoading = true;
    this.api.getAgendaReport(this.fiscalYear).subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res.success) this.reportData = res.data;
      },
      error: () => { this.isLoading = false; }
    });
  }

  onYearChange() { this.loadReport(); }

  printReport() { window.print(); }

  formatNum(v: number | null | undefined): string {
    if (v === null || v === undefined) return '-';
    if (Number.isInteger(v)) return v.toLocaleString('th-TH');
    return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
