import { NgChartsModule } from 'ng2-charts';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../services/api';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { NavbarComponent } from '../shared/navbar/navbar';
import { isAdminRole } from '../guards/auth.guard';

@Component({
  selector: 'app-provincial-kpi',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, NgChartsModule, NavbarComponent],
  templateUrl: './provincial-kpi.html'
})
export class ProvincialKpiComponent implements OnInit {
  // KPI Structure & Provincial Data
  kpiStructure: any[] = [];
  dataMap: { [key: string]: any } = {};   // ผลรวมทั้งจังหวัด (read-only display)

  fiscalYear = 2569;
  availableYears = [2566, 2567, 2568, 2569, 2570];
  months = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  currentUser: any = null;
  isLoggedIn = false;
  isAdmin = false;
  isLoading = true;

  // Chart Modal
  showChartModal = false;
  currentChartTitle = '';
  public chartData: ChartConfiguration<'bar' | 'line'>['data'] = { labels: [], datasets: [] };
  public chartOptions: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: true, position: 'bottom' } }
  };

  // ---- Admin: Hospital Edit Modal ----
  showHospitalModal = false;
  hospitals: any[] = [];
  filteredHospitals: any[] = [];
  amphoeList: string[] = [];
  selectedAmphoeFilter = 'all';
  hospitalSearchText = '';

  selectedHospital: any = null;
  isLoadingHospitalData = false;

  // ข้อมูลของหน่วยบริการที่เลือก
  editDataMap: { [key: string]: any } = {};
  editOriginalDataMap: { [key: string]: any } = {};
  editChangedCells: { [key: string]: 'up' | 'down' | 'same' } = {};
  editPendingChanges: any[] = [];
  isEditing = false;

  // ---- View Mode: อำเภอ / หน่วยบริการ (ตั้งค่าจาก admin-dashboard) ----
  viewMode: 'hospital' | 'amphoe' = 'hospital';

  // ---- Main Indicator Records ----
  showMainIndModal = false;
  mainIndicators: any[] = [];
  mainIndDataMap: { [key: string]: any } = {};
  mainIndOriginalMap: { [key: string]: any } = {};
  mainIndChangedCells: { [key: string]: 'up' | 'down' | 'same' } = {};
  mainIndPendingChanges: any[] = [];
  isMainIndEditing = false;
  isLoadingMainInd = false;
  selectedMainIndAmphoe: string | null = null; // null = ระดับจังหวัด

  constructor(private api: ApiService, private router: Router, private cd: ChangeDetectorRef) {}

  ngOnInit() {
    const userStored = localStorage.getItem('currentUser');
    if (userStored) {
      this.currentUser = JSON.parse(userStored);
      this.isLoggedIn = true;
      this.isAdmin = isAdminRole(this.currentUser.role);
      if (this.isAdmin) {
        this.loadHospitals();
      }
    }
    // โหลดข้อมูลได้เสมอ ไม่ต้อง login
    this.loadAll();
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

  goToHome() {
    this.router.navigate(['/']);
  }

  loadAll() {
    this.isLoading = true;
    Swal.fire({
      title: 'กำลังประมวลผล...',
      html: 'ระบบกำลังดึงข้อมูลภาพรวมจังหวัด',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => { Swal.showLoading(); }
    });

    this.api.getKpiStructure().subscribe({
      next: (res: any) => {
        if (res.success) {
          let structure = res.data;
          // admin_ssj: กรองเฉพาะตัวชี้วัดหลักที่อยู่ใน dep_id เดียวกัน
          if (this.currentUser?.role === 'admin_ssj' && this.currentUser?.dep_id) {
            const myDepId = this.currentUser.dep_id;
            structure = structure.map((issue: any) => ({
              ...issue,
              groups: issue.groups.filter((g: any) => g.mainDepId === myDepId || !g.mainDepId)
            })).filter((issue: any) => issue.groups.length > 0);
          }
          this.kpiStructure = structure;
          this.loadProvincialData();
        }
      },
      error: () => {
        this.isLoading = false;
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถโหลดโครงสร้าง KPI ได้' });
      }
    });
  }

  loadProvincialData() {
    // admin_cup: โหลดเฉพาะข้อมูลอำเภอตัวเอง
    const amphoeFilter = this.currentUser?.role === 'admin_cup' ? this.currentUser.amphoe_name : undefined;
    const obs = amphoeFilter
      ? this.api.getProvincialSummaryByAmphoe(this.fiscalYear, amphoeFilter)
      : this.api.getProvincialSummary(this.fiscalYear);
    obs.subscribe({
      next: (res: any) => {
        this.dataMap = {};
        if (res.success) {
          res.data.forEach((d: any) => {
            const key = `${d.kpi_id}_${d.report_month}`;
            this.dataMap[key] = d.total_value;
          });
        }
        this.isLoading = false;
        this.cd.detectChanges();
        setTimeout(() => {
          Swal.close();
          const Toast = Swal.mixin({
            toast: true, position: 'top-end',
            showConfirmButton: false, timer: 1500, timerProgressBar: true
          });
          Toast.fire({ icon: 'success', title: 'โหลดข้อมูลสำเร็จ' });
        }, 300);
      },
      error: () => {
        this.isLoading = false;
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถโหลดข้อมูลจังหวัดได้' });
      }
    });
  }

  loadHospitals() {
    this.api.getHospitals(true).subscribe({
      next: (res: any) => {
        if (res.success) {
          let data = res.data;
          // admin_cup: เห็นเฉพาะหน่วยบริการในอำเภอเดียวกัน
          if (this.currentUser?.role === 'admin_cup' && this.currentUser?.amphoe_name) {
            data = data.filter((h: any) => h.amphoe_name === this.currentUser.amphoe_name);
          }
          this.hospitals = data;
          this.filteredHospitals = data;
          const set = new Set<string>(data.map((h: any) => h.amphoe_name));
          this.amphoeList = Array.from(set).sort();
        }
      }
    });
  }

  onYearChange() {
    this.loadAll();
  }

  // ---- Chart ----
  openChart(item: any) {
    this.currentChartTitle = item.label;
    const labels = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
    const results = this.months.map(m => {
      const val = this.dataMap[`${item.id}_${m}`];
      return val ? parseFloat(val) : 0;
    });
    const targetVal = this.dataMap[`${item.id}_0`] ? parseFloat(this.dataMap[`${item.id}_0`]) : 0;
    const targets = Array(12).fill(targetVal);
    this.chartData = {
      labels,
      datasets: [
        { type: 'bar', label: 'ผลงาน (รวมทั้งจังหวัด)', data: results, backgroundColor: 'rgba(34,197,94,0.6)', borderColor: 'rgba(34,197,94,1)', borderWidth: 1, order: 2 },
        { type: 'line', label: 'เป้าหมาย (รวม)', data: targets, borderColor: 'rgba(234,179,8,1)', borderWidth: 3, pointRadius: 0, fill: false, order: 1, tension: 0.1 }
      ]
    };
    this.showChartModal = true;
  }

  closeChart() { this.showChartModal = false; }

  // ---- Helpers ----
  getMonthName(m: number): string {
    const names = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return names[m];
  }

  // ผลงานล่าสุด: ดึงค่าจากเดือนล่าสุดที่มีข้อมูล
  getSum(kpiId: number): number {
    for (let i = this.months.length - 1; i >= 0; i--) {
      const val = this.dataMap[`${kpiId}_${this.months[i]}`];
      if (val !== undefined && val !== null && val !== '') return parseFloat(val);
    }
    return 0;
  }

  getPercentage(kpiId: number): number {
    const target = this.dataMap[`${kpiId}_0`];
    const result = this.getSum(kpiId);
    if (!target || parseFloat(target) === 0) return 0;
    return (result / parseFloat(target)) * 100;
  }

  setViewMode(mode: 'hospital' | 'amphoe') {
    this.viewMode = mode;
  }

  findKpiName(kpiId: number): string {
    let name = 'Unknown';
    this.kpiStructure.forEach(issue => {
      issue.groups.forEach((g: any) => {
        g.subs.forEach((s: any) => {
          const item = s.items.find((i: any) => i.id === kpiId);
          if (item) name = item.label;
        });
      });
    });
    return name;
  }

  // ---- Admin: Open Hospital Modal ----
  openHospitalModal() {
    if (!this.isAdmin) return;
    this.selectedHospital = null;
    this.editDataMap = {};
    this.editOriginalDataMap = {};
    this.editChangedCells = {};
    this.editPendingChanges = [];
    this.isEditing = false;
    this.selectedAmphoeFilter = 'all';
    this.hospitalSearchText = '';
    this.applyHospitalFilter();
    this.showHospitalModal = true;
  }

  // เปิด modal และกรองโดย amphoe ที่เกี่ยวข้องกับ cell ที่กด (optional shortcut)
  openEditFromCell(_kpiId: number, _month: number) {
    this.openHospitalModal();
  }

  closeHospitalModal() {
    if (this.editPendingChanges.length > 0) {
      Swal.fire({
        title: 'ยังมีการแก้ไขที่ยังไม่ได้บันทึก',
        text: 'ต้องการออกโดยไม่บันทึกใช่หรือไม่?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'ออกโดยไม่บันทึก',
        cancelButtonText: 'กลับไปแก้ไข'
      }).then(r => {
        if (r.isConfirmed) {
          this.showHospitalModal = false;
        }
      });
    } else {
      this.showHospitalModal = false;
    }
  }

  applyHospitalFilter() {
    let temp = this.hospitals;
    if (this.selectedAmphoeFilter !== 'all') {
      temp = temp.filter(h => h.amphoe_name === this.selectedAmphoeFilter);
    }
    if (this.hospitalSearchText.trim()) {
      const q = this.hospitalSearchText.toLowerCase();
      temp = temp.filter(h =>
        (h.hospital_name && h.hospital_name.toLowerCase().includes(q)) ||
        (h.hospcode && h.hospcode.toLowerCase().includes(q))
      );
    }
    this.filteredHospitals = temp;
  }

  // ---- Amphoe Mode: เลือกอำเภอแล้วแสดงข้อมูลรวมของอำเภอนั้น ----
  selectAmphoe(amphoeName: string) {
    // สร้าง virtual hospital object เพื่อ reuse เดิม
    this.selectedHospital = {
      id: null,
      hospital_name: `รวมอำเภอ${amphoeName}`,
      amphoe_name: amphoeName,
      hospcode: null,
      username: amphoeName,
      _isAmphoe: true
    };
    this.isEditing = false;
    this.editPendingChanges = [];
    this.editChangedCells = {};
    this.isLoadingHospitalData = true;
    this.editDataMap = {};
    this.editOriginalDataMap = {};

    // ดึงข้อมูลรวมรายอำเภอ
    this.api.getProvincialSummaryByAmphoe(this.fiscalYear, amphoeName).subscribe({
      next: (res: any) => {
        if (res.success) {
          res.data.forEach((d: any) => {
            const key = `${d.kpi_id}_${d.report_month}`;
            this.editDataMap[key] = d.total_value;
            this.editOriginalDataMap[key] = d.total_value;
          });
        }
        this.isLoadingHospitalData = false;
        this.cd.detectChanges();
      },
      error: () => {
        this.isLoadingHospitalData = false;
        Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ' });
      }
    });
  }

  selectHospital(h: any) {
    this.selectedHospital = h;
    this.isEditing = false;
    this.editPendingChanges = [];
    this.editChangedCells = {};
    this.isLoadingHospitalData = true;
    this.editDataMap = {};
    this.editOriginalDataMap = {};

    this.api.getKpiData(this.fiscalYear, h.id).subscribe({
      next: (res: any) => {
        if (res.success && res.data.length > 0) {
          res.data.forEach((d: any) => {
            const key = `${d.kpi_id}_${d.report_month}`;
            this.editDataMap[key] = d.kpi_value;
            this.editOriginalDataMap[key] = d.kpi_value;
          });
        }
        this.isLoadingHospitalData = false;
        this.cd.detectChanges();
      },
      error: () => {
        this.isLoadingHospitalData = false;
        Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', text: 'ไม่สามารถดึงข้อมูลหน่วยบริการได้' });
      }
    });
  }

  backToHospitalList() {
    if (this.editPendingChanges.length > 0) {
      Swal.fire({
        title: 'มีการแก้ไขที่ยังไม่บันทึก',
        text: 'ต้องการกลับไปเลือกหน่วยบริการใหม่โดยไม่บันทึกใช่หรือไม่?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'ยืนยัน',
        cancelButtonText: 'ยกเลิก'
      }).then(r => {
        if (r.isConfirmed) {
          this.selectedHospital = null;
          this.editPendingChanges = [];
          this.editChangedCells = {};
          this.isEditing = false;
        }
      });
    } else {
      this.selectedHospital = null;
    }
  }

  // ---- Edit Mode ----
  toggleEdit() {
    if (this.isEditing) {
      // ยกเลิก
      this.editDataMap = { ...this.editOriginalDataMap };
      this.editChangedCells = {};
      this.editPendingChanges = [];
      this.isEditing = false;
      this.cd.detectChanges();
      const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      Toast.fire({ icon: 'info', title: 'ยกเลิกการแก้ไขแล้ว' });
    } else {
      this.isEditing = true;
      const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      Toast.fire({ icon: 'info', title: 'เปิดโหมดแก้ไขแล้ว' });
    }
  }

  getEditSum(kpiId: number): number {
    for (let i = this.months.length - 1; i >= 0; i--) {
      const val = this.editDataMap[`${kpiId}_${this.months[i]}`];
      if (val !== undefined && val !== null && val !== '') return parseFloat(val);
    }
    return 0;
  }

  getEditPercentage(kpiId: number): number {
    const target = this.editDataMap[`${kpiId}_0`];
    const result = this.getEditSum(kpiId);
    if (!target || parseFloat(target) === 0) return 0;
    return (result / parseFloat(target)) * 100;
  }

  getEditCellClass(kpiId: number, month: number): string {
    const key = `${kpiId}_${month}`;
    if (this.editChangedCells[key] === 'up') return 'bg-green-100 ring-1 ring-green-400';
    if (this.editChangedCells[key] === 'down') return 'bg-red-100 ring-1 ring-red-400';
    return '';
  }

  onEditValueChange(kpiId: number, month: number, event: any) {
    let val = event.target.value;
    if (val === '') val = null;
    else {
      val = parseFloat(val);
      if (val < 0) {
        val = 0;
        event.target.value = 0;
        Swal.fire({ icon: 'warning', title: 'ไม่อนุญาตค่าติดลบ', text: 'กรุณากรอกค่า 0 ขึ้นไป', timer: 2000, showConfirmButton: false });
      }
    }
    const key = `${kpiId}_${month}`;
    this.editDataMap[key] = val;

    const originalVal = this.editOriginalDataMap[key] !== undefined ? parseFloat(this.editOriginalDataMap[key]) : null;
    const newVal = val !== null ? parseFloat(val) : null;

    if (originalVal === newVal || (originalVal === null && newVal === null)) {
      delete this.editChangedCells[key];
    } else if (newVal !== null && (originalVal === null || newVal > originalVal)) {
      this.editChangedCells[key] = 'up';
    } else if (newVal !== null && originalVal !== null && newVal < originalVal) {
      this.editChangedCells[key] = 'down';
    } else {
      this.editChangedCells[key] = 'same';
    }

    const idx = this.editPendingChanges.findIndex(c => c.kpi_id === kpiId && c.month === month);
    if (idx > -1) this.editPendingChanges.splice(idx, 1);
    if (originalVal !== newVal) {
      this.editPendingChanges.push({ kpi_id: kpiId, month, value: val, oldValue: originalVal });
    }
  }

  saveHospitalData() {
    if (this.editPendingChanges.length === 0) {
      Swal.fire({ icon: 'warning', title: 'ไม่มีการเปลี่ยนแปลง', text: 'คุณยังไม่ได้แก้ไขข้อมูลใดๆ', confirmButtonText: 'ตกลง' });
      return;
    }

    const decreasedItems = this.editPendingChanges.filter(c => {
      const oldVal = c.oldValue !== null && c.oldValue !== undefined ? parseFloat(c.oldValue) : 0;
      const newVal = c.value !== null && c.value !== undefined ? parseFloat(c.value) : 0;
      return newVal < oldVal;
    });

    let tableHtml = `<div style="text-align:left;max-height:300px;overflow-y:auto;font-size:13px;">`;
    if (decreasedItems.length > 0) {
      tableHtml += `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px;margin-bottom:12px;">
        <div style="color:#dc2626;font-weight:bold;margin-bottom:6px;"><i class="fas fa-exclamation-triangle"></i> แจ้งเตือน: มี ${decreasedItems.length} รายการที่คะแนนลดลง</div>
        ${decreasedItems.map(c => {
          const kpiName = this.findKpiName(c.kpi_id);
          const monthName = c.month === 0 ? 'เป้าหมาย' : this.getMonthName(c.month);
          return `<div style="color:#991b1b;font-size:12px;">&bull; ${kpiName} (${monthName}): ${c.oldValue ?? 0} → ${c.value} <span style="color:#dc2626;font-weight:bold;">▼</span></div>`;
        }).join('')}
      </div>`;
    }
    tableHtml += `<table style="width:100%;border-collapse:collapse;">
      <tr style="background:#f3f4f6;"><th style="padding:6px;text-align:left;">รายการ</th><th style="padding:6px;text-align:center;">เดือน</th><th style="padding:6px;text-align:right;">ค่าเดิม</th><th style="padding:6px;text-align:right;">ค่าใหม่</th><th style="padding:6px;text-align:center;">สถานะ</th></tr>`;
    this.editPendingChanges.forEach(c => {
      const kpiName = this.findKpiName(c.kpi_id);
      const monthName = c.month === 0 ? 'เป้าหมาย' : this.getMonthName(c.month);
      const oldVal = c.oldValue !== null && c.oldValue !== undefined ? parseFloat(c.oldValue) : 0;
      const newVal = c.value !== null ? parseFloat(c.value) : 0;
      const status = newVal > oldVal ? '<span style="color:#16a34a;font-weight:bold;">▲ เพิ่ม</span>' : newVal < oldVal ? '<span style="color:#dc2626;font-weight:bold;">▼ ลด</span>' : '<span style="color:#6b7280;">= เท่าเดิม</span>';
      const bg = newVal > oldVal ? 'background:#f0fdf4;' : newVal < oldVal ? 'background:#fef2f2;' : '';
      tableHtml += `<tr style="border-bottom:1px solid #eee;${bg}">
        <td style="padding:6px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${kpiName}">${kpiName}</td>
        <td style="padding:6px;text-align:center;">${monthName}</td>
        <td style="padding:6px;text-align:right;color:#6b7280;">${c.oldValue ?? '-'}</td>
        <td style="padding:6px;text-align:right;font-weight:bold;color:#2563eb;">${c.value ?? '-'}</td>
        <td style="padding:6px;text-align:center;">${status}</td></tr>`;
    });
    tableHtml += `</table></div>`;

    Swal.fire({
      title: decreasedItems.length > 0 ? '⚠️ ยืนยันการบันทึก' : 'ยืนยันการบันทึก',
      html: tableHtml,
      icon: decreasedItems.length > 0 ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#d33',
      confirmButtonText: '<i class="fas fa-save"></i> ยืนยันบันทึก',
      cancelButtonText: 'ยกเลิก',
      width: '650px'
    }).then((result: any) => {
      if (result.isConfirmed) this.confirmSaveHospital();
    });
  }

  confirmSaveHospital() {
    Swal.fire({ title: 'กำลังบันทึก...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
    this.api.saveBatch({
      userId: this.selectedHospital.id,
      fiscalYear: this.fiscalYear,
      changes: this.editPendingChanges
    }).subscribe({
      next: (res: any) => {
        if (res.success) {
          Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', text: `บันทึกข้อมูลเรียบร้อย ${res.count} รายการ`, timer: 2000, showConfirmButton: false });
          this.editPendingChanges = [];
          this.editChangedCells = {};
          this.isEditing = false;
          Object.assign(this.editOriginalDataMap, this.editDataMap);
          this.loadProvincialData();
        }
      },
      error: () => {
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่' });
      }
    });
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
    this.loadMainIndicators();
  }

  loadMainIndicators() {
    // ดึงโครงสร้าง main indicators จาก kpiStructure
    this.mainIndicators = [];
    this.kpiStructure.forEach(issue => {
      issue.groups.forEach((g: any) => {
        this.mainIndicators.push({
          id: g.mainId,
          name: g.mainInd,
          targetLabel: g.mainTarget,
          depId: g.mainDepId,
          issueTitle: issue.title
        });
      });
    });
    this.loadMainIndData();
  }

  loadMainIndData() {
    this.isLoadingMainInd = true;
    this.mainIndDataMap = {};
    this.mainIndOriginalMap = {};
    this.api.getMainRecords(this.fiscalYear, this.selectedMainIndAmphoe || undefined).subscribe({
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
      }
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
        icon: 'warning', showCancelButton: true,
        confirmButtonColor: '#d33', cancelButtonColor: '#6b7280',
        confirmButtonText: 'ออกโดยไม่บันทึก', cancelButtonText: 'กลับไปแก้ไข'
      }).then(r => { if (r.isConfirmed) this.showMainIndModal = false; });
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

  onMainIndValueChange(indId: number, month: number, event: any) {
    let val = event.target.value;
    if (val === '') val = null;
    else {
      val = parseFloat(val);
      if (val < 0) { val = 0; event.target.value = 0; }
    }
    const key = `${indId}_${month}`;
    this.mainIndDataMap[key] = val;

    const originalVal = this.mainIndOriginalMap[key] !== undefined ? parseFloat(this.mainIndOriginalMap[key]) : null;
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

    const idx = this.mainIndPendingChanges.findIndex(c => c.main_ind_id === indId && c.month === month);
    if (idx > -1) this.mainIndPendingChanges.splice(idx, 1);
    if (originalVal !== newVal) {
      this.mainIndPendingChanges.push({ main_ind_id: indId, month, value: val, oldValue: originalVal });
    }
  }

  findMainIndName(indId: number): string {
    const found = this.mainIndicators.find(i => i.id === indId);
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
    this.mainIndPendingChanges.forEach(c => {
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
      confirmButtonColor: '#10b981', cancelButtonColor: '#d33',
      confirmButtonText: '<i class="fas fa-save"></i> ยืนยันบันทึก',
      cancelButtonText: 'ยกเลิก', width: '650px'
    }).then((result: any) => {
      if (result.isConfirmed) this.confirmSaveMainInd();
    });
  }

  confirmSaveMainInd() {
    Swal.fire({ title: 'กำลังบันทึก...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
    this.api.saveMainRecordsBatch({
      fiscalYear: this.fiscalYear,
      amphoe_name: this.selectedMainIndAmphoe,
      changes: this.mainIndPendingChanges
    }).subscribe({
      next: (res: any) => {
        if (res.success) {
          Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ!', text: `บันทึกข้อมูลเรียบร้อย ${res.count} รายการ`, timer: 2000, showConfirmButton: false });
          this.mainIndPendingChanges = [];
          this.mainIndChangedCells = {};
          this.isMainIndEditing = false;
          Object.assign(this.mainIndOriginalMap, this.mainIndDataMap);
        }
      },
      error: () => {
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่' });
      }
    });
  }
}
