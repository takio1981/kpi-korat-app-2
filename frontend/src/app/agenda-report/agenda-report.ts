import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api';
import { NavbarComponent } from '../shared/navbar/navbar';
import { isAdminRole } from '../guards/auth.guard';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-agenda-report',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './agenda-report.html',
})
export class AgendaReportComponent implements OnInit {
  fiscalYear = 2569;
  availableYears = [2566, 2567, 2568, 2569, 2570];
  reportData: any = null;
  isLoading = false;
  isExporting = false;
  reportDate = '';

  // Auth
  currentUser: any = null;
  isAdmin = false;

  // Main Indicator Modal
  showMainIndModal = false;
  mainIndicators: any[] = [];
  kpiStructure: any[] = [];
  amphoeList: string[] = [];
  months = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  mainIndDataMap: { [key: string]: any } = {};
  mainIndOriginalMap: { [key: string]: any } = {};
  mainIndChangedCells: { [key: string]: 'up' | 'down' | 'same' } = {};
  mainIndPendingChanges: any[] = [];
  isMainIndEditing = false;
  isLoadingMainInd = false;
  selectedMainIndAmphoe: string | null = null;
  // สรุปรวมจังหวัด (อ่านอย่างเดียว)
  provincialSummaryMap: { [key: string]: any } = {};
  isLoadingProvincialSummary = false;

  constructor(
    private api: ApiService,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    const userStored = localStorage.getItem('currentUser');
    if (userStored) {
      this.currentUser = JSON.parse(userStored);
      this.isAdmin = isAdminRole(this.currentUser.role);
    }
    this.setReportDate();
    this.loadReport();
  }

  setReportDate() {
    const now = new Date();
    const thDay = now.getDate();
    const thMonth = [
      '',
      'มกราคม',
      'กุมภาพันธ์',
      'มีนาคม',
      'เมษายน',
      'พฤษภาคม',
      'มิถุนายน',
      'กรกฎาคม',
      'สิงหาคม',
      'กันยายน',
      'ตุลาคม',
      'พฤศจิกายน',
      'ธันวาคม',
    ][now.getMonth() + 1];
    const thYear = now.getFullYear() + 543;
    this.reportDate = `${thDay} ${thMonth} ${thYear}`;
  }

  loadReport() {
    this.isLoading = true;
    this.api.getAgendaReport(this.fiscalYear).subscribe({
      next: (res) => {
        this.isLoading = false;
        console.log('Agenda report response:', res);
        if (res.success) {
          this.reportData = res.data;
          this.mainIndicators = res.mainIndicators || [];
          console.log('Report loaded successfully. Issues:', this.reportData?.issues?.length);
        } else {
          console.error('API returned success=false:', res);
        }
        this.cd.detectChanges();
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Failed to load agenda report:', err);
      },
    });
  }

  getMainIndicatorName(mainIndId: number): string {
    if (!mainIndId) return '';
    const found = this.mainIndicators.find((m: any) => m.id === mainIndId);
    return found ? found.name : '';
  }

  getMainIndicatorTargetLabel(mainIndId: number): string {
    if (!mainIndId) return '';
    const found = this.mainIndicators.find((m: any) => m.id === mainIndId);
    return found ? found.target_label : '';
  }

  /**
   * Check if target is met for indicators 8-10 based on target_label
   * For these indicators, target is met when there are no remaining districts (result_names is empty)
   */
  isIndicatorTargetMet(ind: any): boolean {
    if (ind.no < 8 || ind.no > 10) {
      // For non-8-10 indicators, use numeric comparison
      return ind.result >= ind.target;
    }
    // For indicators 8-10: target is met if there are no districts with unmet targets
    // (i.e., result_names is empty or doesn't exist)
    return !ind.result_names || ind.result_names.length === 0;
  }

  onYearChange() {
    this.loadReport();
  }

  printReport() {
    window.print();
  }

  async exportPDF() {
    const el = document.getElementById('report-page');
    if (!el) return;
    this.isExporting = true;
    this.cd.detectChanges();
    try {
      const origMinHeight = el.style.minHeight;
      el.style.minHeight = 'unset';
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
      });
      el.style.minHeight = origMinHeight;

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const pxPerMm = canvas.width / pageW;
      const pageHeightPx = pageH * pxPerMm;
      const minSlicePx = pxPerMm * 5;

      let yOffset = 0;
      let pageNum = 0;
      while (yOffset < canvas.height) {
        const sliceH = Math.min(pageHeightPx, canvas.height - yOffset);
        if (sliceH < minSlicePx) break;
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

  // ======== Main Indicator Records Modal ========
  openMainIndModal() {
    if (!this.isAdmin) return;
    this.mainIndDataMap = {};
    this.mainIndOriginalMap = {};
    this.mainIndChangedCells = {};
    this.mainIndPendingChanges = [];
    this.isMainIndEditing = false;
    this.selectedMainIndAmphoe = null;
    this.showMainIndModal = true;

    // โหลดโครงสร้าง KPI
    if (this.kpiStructure.length === 0) {
      this.api.getKpiStructure().subscribe({
        next: (res: any) => {
          if (res.success) {
            let structure = res.data;
            if (this.currentUser?.role === 'admin_ssj' && this.currentUser?.dep_id) {
              const myDepId = this.currentUser.dep_id;
              structure = structure
                .map((issue: any) => ({
                  ...issue,
                  groups: issue.groups.filter((g: any) => g.mainDepId === myDepId || !g.mainDepId),
                }))
                .filter((issue: any) => issue.groups.length > 0);
            }
            this.kpiStructure = structure;
            this.buildMainIndicators();
          }
        },
      });
    } else {
      this.buildMainIndicators();
    }

    // โหลดรายชื่ออำเภอ
    if (this.amphoeList.length === 0) {
      this.api.getAmphoes().subscribe({
        next: (res: any) => {
          if (res.success) this.amphoeList = res.data;
        },
      });
    }

    // โหลดสรุปรวมจังหวัด
    this.loadProvincialSummary();
  }

  buildMainIndicators() {
    this.mainIndicators = [];
    this.kpiStructure.forEach((issue) => {
      issue.groups.forEach((g: any) => {
        this.mainIndicators.push({
          id: g.mainId,
          name: g.mainInd,
          targetLabel: g.mainTarget,
          depId: g.mainDepId,
          issueTitle: issue.title,
        });
      });
    });
  }

  loadProvincialSummary() {
    this.isLoadingProvincialSummary = true;
    this.provincialSummaryMap = {};
    this.api.getMainRecordsSummary(this.fiscalYear).subscribe({
      next: (res: any) => {
        if (res.success) {
          res.data.forEach((d: any) => {
            const key = `${d.main_ind_id}_${d.report_month}`;
            this.provincialSummaryMap[key] = parseFloat(d.total_value);
          });
        }
        this.isLoadingProvincialSummary = false;
        this.cd.detectChanges();
      },
      error: () => {
        this.isLoadingProvincialSummary = false;
      },
    });
  }

  getProvincialTarget(indId: number): number {
    return this.provincialSummaryMap[`${indId}_0`] || 0;
  }

  getProvincialResult(indId: number): number {
    // ค่าล่าสุดรวมจังหวัด = sum(เดือนล่าสุดของแต่ละอำเภอ) — คำนวณฝั่ง backend แล้ว
    // ที่นี่แค่ดึง sum ทุกเดือน (backend ส่งมาเป็น sum แล้ว) แต่แสดงเดือนล่าสุด
    for (let i = this.months.length - 1; i >= 0; i--) {
      const val = this.provincialSummaryMap[`${indId}_${this.months[i]}`];
      if (val !== undefined && val > 0) return val;
    }
    return 0;
  }

  getProvincialPct(indId: number): number {
    const t = this.getProvincialTarget(indId);
    const r = this.getProvincialResult(indId);
    return t > 0 ? (r / t) * 100 : 0;
  }

  loadMainIndData() {
    if (!this.selectedMainIndAmphoe) {
      this.mainIndDataMap = {};
      this.mainIndOriginalMap = {};
      this.isLoadingMainInd = false;
      return;
    }
    this.isLoadingMainInd = true;
    this.mainIndDataMap = {};
    this.mainIndOriginalMap = {};
    this.api.getMainRecords(this.fiscalYear, this.selectedMainIndAmphoe).subscribe({
      next: (res: any) => {
        if (res.success) {
          res.data.forEach((d: any) => {
            const key = `${d.main_ind_id}_${d.report_month}`;
            this.mainIndDataMap[key] = d.kpi_value;
            this.mainIndOriginalMap[key] = d.kpi_value;
          });
        }
        this.isLoadingMainInd = false;
        this.cd.detectChanges();
      },
      error: () => {
        this.isLoadingMainInd = false;
        Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ' });
      },
    });
  }

  onMainIndAmphoeChange() {
    this.mainIndPendingChanges = [];
    this.mainIndChangedCells = {};
    this.isMainIndEditing = false;
    this.loadMainIndData();
  }

  closeMainIndModal() {
    if (this.mainIndPendingChanges.length > 0) {
      Swal.fire({
        title: 'ยังมีการแก้ไขที่ยังไม่ได้บันทึก',
        text: 'ต้องการออกโดยไม่บันทึกใช่หรือไม่?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'ออกโดยไม่บันทึก',
        cancelButtonText: 'กลับไปแก้ไข',
      }).then((r) => {
        if (r.isConfirmed) this.showMainIndModal = false;
      });
    } else {
      this.showMainIndModal = false;
    }
  }

  toggleMainIndEdit() {
    if (this.isMainIndEditing) {
      this.mainIndDataMap = { ...this.mainIndOriginalMap };
      this.mainIndChangedCells = {};
      this.mainIndPendingChanges = [];
      this.isMainIndEditing = false;
      this.cd.detectChanges();
    } else {
      this.isMainIndEditing = true;
    }
  }

  getMainIndSum(indId: number): number {
    for (let i = this.months.length - 1; i >= 0; i--) {
      const val = this.mainIndDataMap[`${indId}_${this.months[i]}`];
      if (val !== undefined && val !== null && val !== '') return parseFloat(val);
    }
    return 0;
  }

  getMainIndPct(indId: number): number {
    const target = this.mainIndDataMap[`${indId}_0`];
    const result = this.getMainIndSum(indId);
    if (!target || parseFloat(target) === 0) return 0;
    return (result / parseFloat(target)) * 100;
  }

  getMainIndCellClass(indId: number, month: number): string {
    const key = `${indId}_${month}`;
    if (this.mainIndChangedCells[key] === 'up') return 'bg-green-100 ring-1 ring-green-400';
    if (this.mainIndChangedCells[key] === 'down') return 'bg-red-100 ring-1 ring-red-400';
    return '';
  }

  getMonthName(m: number): string {
    const names = [
      '',
      'ม.ค.',
      'ก.พ.',
      'มี.ค.',
      'เม.ย.',
      'พ.ค.',
      'มิ.ย.',
      'ก.ค.',
      'ส.ค.',
      'ก.ย.',
      'ต.ค.',
      'พ.ย.',
      'ธ.ค.',
    ];
    return names[m];
  }

  onMainIndValueChange(indId: number, month: number, event: any) {
    let val = event.target.value;
    if (val === '') val = null;
    else {
      val = parseFloat(val);
      if (val < 0) {
        val = 0;
        event.target.value = 0;
      }
    }
    const key = `${indId}_${month}`;
    this.mainIndDataMap[key] = val;

    const originalVal =
      this.mainIndOriginalMap[key] !== undefined ? parseFloat(this.mainIndOriginalMap[key]) : null;
    const newVal = val !== null ? parseFloat(val) : null;

    if (originalVal === newVal || (originalVal === null && newVal === null)) {
      delete this.mainIndChangedCells[key];
    } else if (newVal !== null && (originalVal === null || newVal > originalVal)) {
      this.mainIndChangedCells[key] = 'up';
    } else if (newVal !== null && originalVal !== null && newVal < originalVal) {
      this.mainIndChangedCells[key] = 'down';
    } else {
      this.mainIndChangedCells[key] = 'same';
    }

    const idx = this.mainIndPendingChanges.findIndex(
      (c) => c.main_ind_id === indId && c.month === month,
    );
    if (idx > -1) this.mainIndPendingChanges.splice(idx, 1);
    if (originalVal !== newVal) {
      this.mainIndPendingChanges.push({
        main_ind_id: indId,
        month,
        value: val,
        oldValue: originalVal,
      });
    }
  }

  findMainIndName(indId: number): string {
    const found = this.mainIndicators.find((i) => i.id === indId);
    return found ? found.name : 'Unknown';
  }

  saveMainIndData() {
    if (this.mainIndPendingChanges.length === 0) {
      Swal.fire({ icon: 'warning', title: 'ไม่มีการเปลี่ยนแปลง', confirmButtonText: 'ตกลง' });
      return;
    }

    let tableHtml = `<div style="text-align:left;max-height:300px;overflow-y:auto;font-size:13px;">
      <table style="width:100%;border-collapse:collapse;">
      <tr style="background:#f3f4f6;"><th style="padding:6px;text-align:left;">ตัวชี้วัด</th><th style="padding:6px;text-align:center;">เดือน</th><th style="padding:6px;text-align:right;">ค่าเดิม</th><th style="padding:6px;text-align:right;">ค่าใหม่</th></tr>`;
    this.mainIndPendingChanges.forEach((c) => {
      const name = this.findMainIndName(c.main_ind_id);
      const monthName = c.month === 0 ? 'เป้าหมาย' : this.getMonthName(c.month);
      tableHtml += `<tr style="border-bottom:1px solid #eee;">
        <td style="padding:6px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</td>
        <td style="padding:6px;text-align:center;">${monthName}</td>
        <td style="padding:6px;text-align:right;color:#6b7280;">${c.oldValue ?? '-'}</td>
        <td style="padding:6px;text-align:right;font-weight:bold;color:#2563eb;">${c.value ?? '-'}</td></tr>`;
    });
    tableHtml += `</table></div>`;

    Swal.fire({
      title: 'ยืนยันการบันทึกผลงานตัวชี้วัดหลัก',
      html: tableHtml,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#d33',
      confirmButtonText: '<i class="fas fa-save"></i> ยืนยันบันทึก',
      cancelButtonText: 'ยกเลิก',
      width: '650px',
    }).then((result: any) => {
      if (result.isConfirmed) this.confirmSaveMainInd();
    });
  }

  confirmSaveMainInd() {
    Swal.fire({
      title: 'กำลังบันทึก...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });
    this.api
      .saveMainRecordsBatch({
        fiscalYear: this.fiscalYear,
        amphoe_name: this.selectedMainIndAmphoe,
        changes: this.mainIndPendingChanges,
      })
      .subscribe({
        next: (res: any) => {
          if (res.success) {
            Swal.fire({
              icon: 'success',
              title: 'บันทึกสำเร็จ!',
              text: `บันทึกข้อมูลเรียบร้อย ${res.count} รายการ`,
              timer: 2000,
              showConfirmButton: false,
            });
            this.mainIndPendingChanges = [];
            this.mainIndChangedCells = {};
            this.isMainIndEditing = false;
            Object.assign(this.mainIndOriginalMap, this.mainIndDataMap);
            // รีโหลดรายงานและสรุปจังหวัด
            this.loadReport();
            this.loadProvincialSummary();
          }
        },
        error: () => {
          Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่',
          });
        },
      });
  }
}
