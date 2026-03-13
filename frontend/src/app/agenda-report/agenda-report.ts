import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api';
import { NavbarComponent } from '../shared/navbar/navbar';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

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
  isExporting = false;
  reportDate = '';

  constructor(private api: ApiService, private cd: ChangeDetectorRef) {}

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
        this.cd.detectChanges();
      },
      error: () => { this.isLoading = false; }
    });
  }

  onYearChange() { this.loadReport(); }

  printReport() { window.print(); }

  async exportPDF() {
    const el = document.getElementById('report-page');
    if (!el) return;
    this.isExporting = true;
    this.cd.detectChanges();
    try {
      // ชั่วคราวยกเลิก min-height เพื่อให้ canvas สูงแค่เนื้อหาจริง
      const origMinHeight = el.style.minHeight;
      el.style.minHeight = 'unset';
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff'
      });
      el.style.minHeight = origMinHeight;

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();   // 210mm
      const pageH = pdf.internal.pageSize.getHeight();  // 297mm

      // pixels ต่อ 1 mm (ใช้ความกว้าง canvas เทียบกับ A4 width)
      const pxPerMm = canvas.width / pageW;
      const pageHeightPx = pageH * pxPerMm;  // ความสูง 1 หน้า A4 เป็น px
      const minSlicePx = pxPerMm * 5;        // ไม่สร้างหน้าถ้าเนื้อหาเหลือน้อยกว่า 5mm

      let yOffset = 0;
      let pageNum = 0;
      while (yOffset < canvas.height) {
        const sliceH = Math.min(pageHeightPx, canvas.height - yOffset);
        if (sliceH < minSlicePx) break;  // ข้ามหน้าว่างหรือเกือบว่าง
        if (pageNum > 0) pdf.addPage();
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceH;
        const ctx = pageCanvas.getContext('2d')!;
        ctx.drawImage(canvas, 0, yOffset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, sliceH / pxPerMm);
        yOffset += pageHeightPx;
        pageNum++;
      }
      pdf.save(`Agenda-KORAT-${this.fiscalYear}.pdf`);
    } finally {
      this.isExporting = false;
      this.cd.detectChanges();
    }
  }

  formatNum(v: number | null | undefined): string {
    if (v === null || v === undefined) return '-';
    if (Number.isInteger(v)) return v.toLocaleString('th-TH');
    return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
