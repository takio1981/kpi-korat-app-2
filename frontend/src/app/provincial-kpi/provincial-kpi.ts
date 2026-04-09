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
  templateUrl: './provincial-kpi.html',
})
export class ProvincialKpiComponent implements OnInit {
  // KPI Structure & Provincial Data
  kpiStructure: any[] = [];
  dataMap: { [key: string]: any } = {}; // ผลรวมทั้งจังหวัด (read-only display)

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
    plugins: { legend: { display: true, position: 'bottom' } },
  };

  // ---- Admin: Hospital Edit Modal ----
  showHospitalModal = false;
  hospitals: any[] = [];
  filteredHospitals: any[] = [];
  amphoeList: string[] = [];
  selectedAmphoeFilter = 'all';
  selectedHospitalFilter = 'all';
  hospitalSearchText = '';

  selectedHospital: any = null;
  isLoadingHospitalData = false;

  // ข้อมูลของหน่วยบริการที่เลือก
  editDataMap: { [key: string]: any } = {};
  editOriginalDataMap: { [key: string]: any } = {};
  editChangedCells: { [key: string]: 'up' | 'down' | 'same' } = {};
  editPendingChanges: any[] = [];
  isEditing = false;

  // ---- View Mode (จากเดิม) — เก็บไว้เพื่อ backward compat ----
  viewMode: 'hospital' | 'amphoe' = 'hospital';

  // ---- New: View Selection (province / hospital / amphoe) ----
  viewSelection: { type: 'province' | 'hospital' | 'amphoe'; id?: number; name?: string; cupUserId?: number } = { type: 'province' };
  // map ที่ใช้แสดงในตารางหลัก (province → dataMap, อื่นๆ → editDataMap)
  showHospitalPicker = false;
  showAmphoePicker = false;
  isLoadingViewData = false;
  // โหมดแก้ไขในตารางหลัก
  mainEditMode = false;
  mainPendingChanges: any[] = [];
  mainChangedCells: { [key: string]: 'up' | 'down' | 'same' } = {};
  mainOriginalMap: { [key: string]: any } = {};

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

  constructor(
    private api: ApiService,
    private router: Router,
    private cd: ChangeDetectorRef,
  ) {}

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
      didOpen: () => {
        Swal.showLoading();
      },
    });

    this.api.getKpiStructure().subscribe({
      next: (res: any) => {
        if (res.success) {
          // admin_ssj: เห็นทุกตัวชี้วัด ทุกอำเภอ (ไม่ filter ตาม dep_id ในหน้านี้)
          this.kpiStructure = res.data;
          this.loadProvincialData();
        }
      },
      error: () => {
        this.isLoading = false;
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: 'ไม่สามารถโหลดโครงสร้าง KPI ได้',
        });
      },
    });
  }

  loadProvincialData() {
    // โหลดภาพรวมจังหวัด (admin_ssj/super_admin เห็นทุกอำเภอ)
    // admin_cup จะเห็นทุกอำเภอเช่นกัน แต่จะ filter ในตอนแก้ไขใน modal
    this.api.getProvincialSummary(this.fiscalYear).subscribe({
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
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 1500,
            timerProgressBar: true,
          });
          Toast.fire({ icon: 'success', title: 'โหลดข้อมูลสำเร็จ' });
        }, 300);
      },
      error: () => {
        this.isLoading = false;
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: 'ไม่สามารถโหลดข้อมูลจังหวัดได้',
        });
      },
    });
  }

  loadHospitals() {
    this.api.getHospitals(true).subscribe({
      next: (res: any) => {
        console.log('[loadHospitals] response:', res);
        if (res.success) {
          let data = res.data || [];
          // admin_cup: เห็นเฉพาะหน่วยบริการในอำเภอเดียวกัน
          if (this.currentUser?.role === 'admin_cup' && this.currentUser?.amphoe_name) {
            data = data.filter((h: any) => h.amphoe_name === this.currentUser.amphoe_name);
          }
          this.hospitals = data;
          this.filteredHospitals = data;
          // กรอง null/empty ออก แล้วสร้างรายการอำเภอ
          const set = new Set<string>(
            data.map((h: any) => h.amphoe_name).filter((a: string) => a && a.trim() !== '')
          );
          this.amphoeList = Array.from(set).sort();
          // Debug: นับแยกตาม role เพื่อยืนยันว่ามี admin_cup
          const roleCount: { [k: string]: number } = {};
          data.forEach((h: any) => { roleCount[h.role || 'null'] = (roleCount[h.role || 'null'] || 0) + 1; });
          console.log('[loadHospitals] hospitals:', data.length, 'amphoes:', this.amphoeList.length, 'by role:', roleCount);
          // Fallback: ถ้าไม่มีอำเภอจาก hospitals → ดึงจาก /admin/amphoes โดยตรง
          if (this.amphoeList.length === 0) {
            this.loadAmphoesFallback();
          } else {
            this.cd.detectChanges();
          }
        }
      },
      error: (err) => {
        console.error('[loadHospitals] error:', err);
        // ถ้าโหลด hospitals ไม่ได้ ลอง fallback
        this.loadAmphoesFallback();
      },
    });
  }

  loadAmphoesFallback() {
    this.api.getAmphoes().subscribe({
      next: (res: any) => {
        if (res.success && Array.isArray(res.data)) {
          let list = res.data.filter((a: string) => a && a.trim() !== '');
          if (this.currentUser?.role === 'admin_cup' && this.currentUser?.amphoe_name) {
            list = list.filter((a: string) => a === this.currentUser.amphoe_name);
          }
          this.amphoeList = list.sort();
          console.log('[fallback amphoes]', this.amphoeList);
          this.cd.detectChanges();
        }
      },
    });
  }

  onYearChange() {
    this.loadAll();
  }

  // ---- Chart ----
  openChart(item: any) {
    this.currentChartTitle = item.label;
    const labels = [
      'ต.ค.',
      'พ.ย.',
      'ธ.ค.',
      'ม.ค.',
      'ก.พ.',
      'มี.ค.',
      'เม.ย.',
      'พ.ค.',
      'มิ.ย.',
      'ก.ค.',
      'ส.ค.',
      'ก.ย.',
    ];
    const results = this.months.map((m) => {
      const val = this.dataMap[`${item.id}_${m}`];
      return val ? parseFloat(val) : 0;
    });
    const targetVal = this.dataMap[`${item.id}_0`] ? parseFloat(this.dataMap[`${item.id}_0`]) : 0;
    const targets = Array(12).fill(targetVal);
    this.chartData = {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'ผลงาน (รวมทั้งจังหวัด)',
          data: results,
          backgroundColor: 'rgba(34,197,94,0.6)',
          borderColor: 'rgba(34,197,94,1)',
          borderWidth: 1,
          order: 2,
        },
        {
          type: 'line',
          label: 'เป้าหมาย (รวม)',
          data: targets,
          borderColor: 'rgba(234,179,8,1)',
          borderWidth: 3,
          pointRadius: 0,
          fill: false,
          order: 1,
          tension: 0.1,
        },
      ],
    };
    this.showChartModal = true;
  }

  closeChart() {
    this.showChartModal = false;
  }

  // ---- Helpers ----
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

  // ============================================================
  // View Selection (ภาพรวมจังหวัด / หน่วยบริการ / อำเภอ)
  // ============================================================

  // ดึงค่าสำหรับแสดงในตารางหลักตาม viewSelection
  getDisplayValue(kpiId: number, month: number): any {
    const key = `${kpiId}_${month}`;
    if (this.viewSelection.type === 'province') {
      return this.dataMap[key];
    }
    return this.editDataMap[key];
  }

  // ผลงานล่าสุด
  getDisplaySum(kpiId: number): number {
    for (let i = this.months.length - 1; i >= 0; i--) {
      const v = this.getDisplayValue(kpiId, this.months[i]);
      if (v !== undefined && v !== null && v !== '') return parseFloat(v);
    }
    return 0;
  }

  getDisplayPercentage(kpiId: number): number {
    const target = this.getDisplayValue(kpiId, 0);
    const result = this.getDisplaySum(kpiId);
    if (!target || parseFloat(target) === 0) return 0;
    return (result / parseFloat(target)) * 100;
  }

  getDisplayCellClass(kpiId: number, month: number): string {
    if (!this.mainEditMode) return '';
    const key = `${kpiId}_${month}`;
    if (this.mainChangedCells[key] === 'up') return 'bg-green-100 ring-1 ring-green-400';
    if (this.mainChangedCells[key] === 'down') return 'bg-red-100 ring-1 ring-red-400';
    return '';
  }

  // ---- Collapsed sections (สำหรับ mobile/tablet card view) ----
  collapsedIssues: { [id: number]: boolean } = {};
  collapsedGroups: { [id: number]: boolean } = {};
  collapsedSubs: { [id: number]: boolean } = {};
  collapsedItems: { [id: number]: boolean } = {};

  toggleIssue(id: number) { this.collapsedIssues[id] = !this.collapsedIssues[id]; }
  toggleGroup(id: number) { this.collapsedGroups[id] = !this.collapsedGroups[id]; }
  toggleSub(id: number) { this.collapsedSubs[id] = !this.collapsedSubs[id]; }
  toggleItem(id: number, ev?: Event) { if (ev) ev.stopPropagation(); this.collapsedItems[id] = !this.collapsedItems[id]; }
  isIssueCollapsed(id: number) { return !!this.collapsedIssues[id]; }
  isGroupCollapsed(id: number) { return !!this.collapsedGroups[id]; }
  isSubCollapsed(id: number) { return !!this.collapsedSubs[id]; }
  isItemCollapsed(id: number) { return !!this.collapsedItems[id]; }

  expandAll() {
    this.collapsedIssues = {};
    this.collapsedGroups = {};
    this.collapsedSubs = {};
  }

  collapseAll() {
    this.kpiStructure.forEach((issue: any) => {
      this.collapsedIssues[issue.id] = true;
    });
  }

  // ---- รวมเป้าหมาย / ผลงาน / % ตาม sub_activity ----
  getSubTarget(sub: any): number {
    let sum = 0;
    for (const item of sub.items || []) {
      const v = this.getDisplayValue(item.id, 0);
      if (v !== undefined && v !== null && v !== '') sum += parseFloat(v);
    }
    return sum;
  }

  getSubResult(sub: any): number {
    let sum = 0;
    for (const item of sub.items || []) {
      sum += this.getDisplaySum(item.id);
    }
    return sum;
  }

  getSubPercentage(sub: any): number {
    const t = this.getSubTarget(sub);
    if (t === 0) return 0;
    return (this.getSubResult(sub) / t) * 100;
  }

  getSubMonthValue(sub: any, month: number): number {
    let sum = 0;
    for (const item of sub.items || []) {
      const v = this.getDisplayValue(item.id, month);
      if (v !== undefined && v !== null && v !== '') sum += parseFloat(v);
    }
    return sum;
  }

  // -------- Picker: หน่วยบริการ --------
  openHospitalPicker() {
    if (this.hospitals.length === 0 || this.amphoeList.length === 0) {
      this.loadHospitals();
    }
    this.selectedAmphoeFilter = 'all';
    this.selectedHospitalFilter = 'all';
    this.hospitalSearchText = '';
    this.applyHospitalFilter();
    this.showHospitalPicker = true;
  }

  closeHospitalPicker() {
    this.showHospitalPicker = false;
  }

  pickHospitalForView(h: any) {
    this.showHospitalPicker = false;
    this.viewSelection = { type: 'hospital', id: h.id, name: h.hospital_name };
    this.loadHospitalDataForView(h.id, h);
  }

  loadHospitalDataForView(userId: number, h: any) {
    this.isLoadingViewData = true;
    this.editDataMap = {};
    this.mainOriginalMap = {};
    this.mainPendingChanges = [];
    this.mainChangedCells = {};
    this.mainEditMode = false;
    this.api.getKpiData(this.fiscalYear, userId).subscribe({
      next: (res: any) => {
        if (res.success && res.data.length > 0) {
          res.data.forEach((d: any) => {
            const key = `${d.kpi_id}_${d.report_month}`;
            this.editDataMap[key] = d.kpi_value;
            this.mainOriginalMap[key] = d.kpi_value;
          });
        }
        this.selectedHospital = h;
        this.isLoadingViewData = false;
        this.cd.detectChanges();
      },
      error: () => {
        this.isLoadingViewData = false;
        Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ' });
      },
    });
  }

  // -------- Picker: อำเภอ --------
  openAmphoePicker() {
    if (this.amphoeList.length === 0) {
      this.loadHospitals();
    }
    this.showAmphoePicker = true;
  }

  closeAmphoePicker() {
    this.showAmphoePicker = false;
  }

  pickAmphoeForView(amphoeName: string) {
    this.showAmphoePicker = false;
    this.isLoadingViewData = true;
    this.editDataMap = {};
    this.mainOriginalMap = {};
    this.mainPendingChanges = [];
    this.mainChangedCells = {};
    this.mainEditMode = false;

    // หา cup user (สสอ.) สำหรับใช้เป็นเป้าหมายเมื่อบันทึกแก้ไข
    this.api.getCupUser(amphoeName).subscribe({
      next: (cupRes: any) => {
        const cupUserId = cupRes.success ? cupRes.data.id : undefined;
        this.viewSelection = { type: 'amphoe', name: amphoeName, cupUserId };
        this.selectedHospital = {
          id: cupUserId || null,
          hospital_name: `อำเภอ${amphoeName}`,
          amphoe_name: amphoeName,
          _isAmphoe: true,
        };
        // โหลดข้อมูลรวมทุกหน่วยบริการในอำเภอ
        this.loadAmphoeAggregateData(amphoeName);
      },
      error: () => {
        // ไม่มี cup user ก็ยังโหลดข้อมูลรวมอำเภอได้ (แต่จะแก้ไขไม่ได้)
        this.viewSelection = { type: 'amphoe', name: amphoeName };
        this.selectedHospital = {
          id: null,
          hospital_name: `อำเภอ${amphoeName}`,
          amphoe_name: amphoeName,
          _isAmphoe: true,
        };
        this.loadAmphoeAggregateData(amphoeName);
      },
    });
  }

  loadAmphoeAggregateData(amphoeName: string) {
    this.api.getProvincialSummaryByAmphoe(this.fiscalYear, amphoeName).subscribe({
      next: (res: any) => {
        if (res.success) {
          res.data.forEach((d: any) => {
            const key = `${d.kpi_id}_${d.report_month}`;
            this.editDataMap[key] = d.total_value;
            this.mainOriginalMap[key] = d.total_value;
          });
        }
        this.isLoadingViewData = false;
        this.cd.detectChanges();
      },
      error: () => {
        this.isLoadingViewData = false;
        Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ' });
      },
    });
  }

  resetToProvinceView() {
    this.viewSelection = { type: 'province' };
    this.selectedHospital = null;
    this.editDataMap = {};
    this.mainOriginalMap = {};
    this.mainPendingChanges = [];
    this.mainChangedCells = {};
    this.mainEditMode = false;
  }

  // -------- Edit Mode in Main Table --------
  toggleMainEditMode() {
    if (this.viewSelection.type === 'province') {
      Swal.fire({
        icon: 'info',
        title: 'กรุณาเลือกหน่วยบริการหรืออำเภอก่อน',
        text: 'การแก้ไขทำได้เฉพาะเมื่อเลือกหน่วยบริการหรืออำเภอที่ต้องการ',
        confirmButtonText: 'ตกลง',
      });
      return;
    }
    if (this.mainEditMode) {
      // ยกเลิก → คืนค่าเดิม
      this.editDataMap = { ...this.mainOriginalMap };
      this.mainChangedCells = {};
      this.mainPendingChanges = [];
      this.mainEditMode = false;
      this.cd.detectChanges();
    } else {
      this.mainEditMode = true;
    }
  }

  onMainValueChange(kpiId: number, month: number, event: any) {
    let val: any = event.target.value;
    if (val === '') val = null;
    else {
      val = parseFloat(val);
      if (val < 0) {
        val = 0;
        event.target.value = 0;
      }
    }
    const key = `${kpiId}_${month}`;
    this.editDataMap[key] = val;

    const orig = this.mainOriginalMap[key] !== undefined ? parseFloat(this.mainOriginalMap[key]) : null;
    const newV = val !== null ? parseFloat(val) : null;

    if (orig === newV || (orig === null && newV === null)) {
      delete this.mainChangedCells[key];
    } else if (newV !== null && (orig === null || newV > orig)) {
      this.mainChangedCells[key] = 'up';
    } else if (newV !== null && orig !== null && newV < orig) {
      this.mainChangedCells[key] = 'down';
    } else {
      this.mainChangedCells[key] = 'same';
    }

    const idx = this.mainPendingChanges.findIndex((c) => c.kpi_id === kpiId && c.month === month);
    if (idx > -1) this.mainPendingChanges.splice(idx, 1);
    if (orig !== newV) {
      this.mainPendingChanges.push({ kpi_id: kpiId, month, value: val, oldValue: orig });
    }
  }

  saveMainEdit() {
    if (this.mainPendingChanges.length === 0) {
      Swal.fire({ icon: 'warning', title: 'ไม่มีการเปลี่ยนแปลง' });
      return;
    }
    if (this.viewSelection.type === 'province') return;

    const targetUserId =
      this.viewSelection.type === 'amphoe'
        ? this.viewSelection.cupUserId
        : this.viewSelection.id;
    if (!targetUserId) {
      Swal.fire({ icon: 'error', title: 'ไม่พบเป้าหมายในการบันทึก' });
      return;
    }

    Swal.fire({
      title: `ยืนยันบันทึก ${this.mainPendingChanges.length} รายการ?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'บันทึก',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#10b981',
    }).then((r) => {
      if (!r.isConfirmed) return;
      Swal.fire({ title: 'กำลังบันทึก...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
      this.api
        .saveBatch({
          userId: targetUserId,
          fiscalYear: this.fiscalYear,
          changes: this.mainPendingChanges,
          amphoeMode: this.viewSelection.type === 'amphoe',
        })
        .subscribe({
          next: (res: any) => {
            if (res.success) {
              Swal.fire({
                icon: 'success',
                title: 'บันทึกสำเร็จ!',
                text: `${res.count} รายการ`,
                timer: 1500,
                showConfirmButton: false,
              });
              this.mainPendingChanges = [];
              this.mainChangedCells = {};
              this.mainEditMode = false;
              Object.assign(this.mainOriginalMap, this.editDataMap);
              this.loadProvincialData();
            }
          },
          error: () => {
            Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ' });
          },
        });
    });
  }

  findKpiName(kpiId: number): string {
    let name = 'Unknown';
    this.kpiStructure.forEach((issue) => {
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
    this.selectedHospitalFilter = 'all';
    this.hospitalSearchText = '';
    // ถ้ายังไม่ได้โหลด หรือ amphoeList ว่างให้โหลดใหม่
    if (this.hospitals.length === 0 || this.amphoeList.length === 0) {
      this.loadHospitals();
    } else {
      this.applyHospitalFilter();
    }
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
        cancelButtonText: 'กลับไปแก้ไข',
      }).then((r) => {
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
    // 1. กรองอำเภอ
    if (this.selectedAmphoeFilter !== 'all') {
      temp = temp.filter((h) => h.amphoe_name === this.selectedAmphoeFilter);
    }
    // 2. กรองหน่วยบริการที่เลือก (เฉพาะกรณีไม่ใช่ 'all')
    if (this.selectedHospitalFilter !== 'all') {
      const hId = parseInt(this.selectedHospitalFilter);
      temp = temp.filter((h) => h.id === hId);
    }
    // 3. ค้นหาด้วยข้อความ
    if (this.hospitalSearchText.trim()) {
      const q = this.hospitalSearchText.toLowerCase();
      temp = temp.filter(
        (h) =>
          (h.hospital_name && h.hospital_name.toLowerCase().includes(q)) ||
          (h.hospcode && h.hospcode.toLowerCase().includes(q)),
      );
    }
    this.filteredHospitals = temp;
  }

  // เมื่อเลือกอำเภอ → reset hospital filter
  onAmphoeFilterChange() {
    this.selectedHospitalFilter = 'all';
    this.applyHospitalFilter();
  }

  // รายการหน่วยบริการตาม amphoe ที่เลือก (สำหรับ dropdown)
  get hospitalsForDropdown(): any[] {
    if (this.selectedAmphoeFilter === 'all') return this.hospitals;
    return this.hospitals.filter((h) => h.amphoe_name === this.selectedAmphoeFilter);
  }

  // ---- Amphoe Mode: เลือกอำเภอแล้วโหลดข้อมูลของ admin_cup user (สสอ.) ของอำเภอนั้น ----
  selectAmphoe(amphoeName: string) {
    this.isLoadingHospitalData = true;
    this.editDataMap = {};
    this.editOriginalDataMap = {};
    this.editPendingChanges = [];
    this.editChangedCells = {};
    this.isEditing = false;

    // 1. หา cup user (สสอ.) ของอำเภอนี้ก่อน
    this.api.getCupUser(amphoeName).subscribe({
      next: (cupRes: any) => {
        if (!cupRes.success) {
          this.isLoadingHospitalData = false;
          Swal.fire({ icon: 'error', title: 'ไม่พบสำนักงานสาธารณสุขอำเภอ', text: `อำเภอ${amphoeName}` });
          return;
        }
        const cupUser = cupRes.data;
        // 2. สร้าง virtual hospital object โดยใช้ user_id ของ cup เป็นตัวแทน
        this.selectedHospital = {
          id: cupUser.id,
          hospital_name: `สสอ.${amphoeName}`,
          amphoe_name: amphoeName,
          hospcode: null,
          username: cupUser.username,
          _isAmphoe: true,
          _cupUserId: cupUser.id,
        };
        // 3. โหลด KPI data ของ cup user (บันทึกใน kpi_records ตามปกติ)
        this.api.getKpiData(this.fiscalYear, cupUser.id).subscribe({
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
            Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ' });
          },
        });
      },
      error: (err: any) => {
        this.isLoadingHospitalData = false;
        Swal.fire({
          icon: 'error',
          title: 'ไม่พบสำนักงานสาธารณสุขอำเภอ',
          text: err?.error?.error || `ไม่พบ admin_cup สำหรับอำเภอ${amphoeName}`,
        });
      },
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
        Swal.fire({
          icon: 'error',
          title: 'โหลดข้อมูลไม่สำเร็จ',
          text: 'ไม่สามารถดึงข้อมูลหน่วยบริการได้',
        });
      },
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
        cancelButtonText: 'ยกเลิก',
      }).then((r) => {
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
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1500,
      });
      Toast.fire({ icon: 'info', title: 'ยกเลิกการแก้ไขแล้ว' });
    } else {
      this.isEditing = true;
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1500,
      });
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
        Swal.fire({
          icon: 'warning',
          title: 'ไม่อนุญาตค่าติดลบ',
          text: 'กรุณากรอกค่า 0 ขึ้นไป',
          timer: 2000,
          showConfirmButton: false,
        });
      }
    }
    const key = `${kpiId}_${month}`;
    this.editDataMap[key] = val;

    const originalVal =
      this.editOriginalDataMap[key] !== undefined
        ? parseFloat(this.editOriginalDataMap[key])
        : null;
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

    const idx = this.editPendingChanges.findIndex((c) => c.kpi_id === kpiId && c.month === month);
    if (idx > -1) this.editPendingChanges.splice(idx, 1);
    if (originalVal !== newVal) {
      this.editPendingChanges.push({ kpi_id: kpiId, month, value: val, oldValue: originalVal });
    }
  }

  saveHospitalData() {
    if (this.editPendingChanges.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่มีการเปลี่ยนแปลง',
        text: 'คุณยังไม่ได้แก้ไขข้อมูลใดๆ',
        confirmButtonText: 'ตกลง',
      });
      return;
    }

    const decreasedItems = this.editPendingChanges.filter((c) => {
      const oldVal = c.oldValue !== null && c.oldValue !== undefined ? parseFloat(c.oldValue) : 0;
      const newVal = c.value !== null && c.value !== undefined ? parseFloat(c.value) : 0;
      return newVal < oldVal;
    });

    let tableHtml = `<div style="text-align:left;max-height:300px;overflow-y:auto;font-size:13px;">`;
    if (decreasedItems.length > 0) {
      tableHtml += `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px;margin-bottom:12px;">
        <div style="color:#dc2626;font-weight:bold;margin-bottom:6px;"><i class="fas fa-exclamation-triangle"></i> แจ้งเตือน: มี ${decreasedItems.length} รายการที่คะแนนลดลง</div>
        ${decreasedItems
          .map((c) => {
            const kpiName = this.findKpiName(c.kpi_id);
            const monthName = c.month === 0 ? 'เป้าหมาย' : this.getMonthName(c.month);
            return `<div style="color:#991b1b;font-size:12px;">&bull; ${kpiName} (${monthName}): ${c.oldValue ?? 0} → ${c.value} <span style="color:#dc2626;font-weight:bold;">▼</span></div>`;
          })
          .join('')}
      </div>`;
    }
    tableHtml += `<table style="width:100%;border-collapse:collapse;">
      <tr style="background:#f3f4f6;"><th style="padding:6px;text-align:left;">รายการ</th><th style="padding:6px;text-align:center;">เดือน</th><th style="padding:6px;text-align:right;">ค่าเดิม</th><th style="padding:6px;text-align:right;">ค่าใหม่</th><th style="padding:6px;text-align:center;">สถานะ</th></tr>`;
    this.editPendingChanges.forEach((c) => {
      const kpiName = this.findKpiName(c.kpi_id);
      const monthName = c.month === 0 ? 'เป้าหมาย' : this.getMonthName(c.month);
      const oldVal = c.oldValue !== null && c.oldValue !== undefined ? parseFloat(c.oldValue) : 0;
      const newVal = c.value !== null ? parseFloat(c.value) : 0;
      const status =
        newVal > oldVal
          ? '<span style="color:#16a34a;font-weight:bold;">▲ เพิ่ม</span>'
          : newVal < oldVal
            ? '<span style="color:#dc2626;font-weight:bold;">▼ ลด</span>'
            : '<span style="color:#6b7280;">= เท่าเดิม</span>';
      const bg =
        newVal > oldVal ? 'background:#f0fdf4;' : newVal < oldVal ? 'background:#fef2f2;' : '';
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
      width: '650px',
    }).then((result: any) => {
      if (result.isConfirmed) this.confirmSaveHospital();
    });
  }

  confirmSaveHospital() {
    Swal.fire({
      title: 'กำลังบันทึก...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
    });
    this.api
      .saveBatch({
        userId: this.selectedHospital.id,
        fiscalYear: this.fiscalYear,
        changes: this.editPendingChanges,
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
            this.editPendingChanges = [];
            this.editChangedCells = {};
            this.isEditing = false;
            Object.assign(this.editOriginalDataMap, this.editDataMap);
            this.loadProvincialData();
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
    this.kpiStructure.forEach((issue) => {
      issue.groups.forEach((g: any) => {
        this.mainIndicators.push({
          id: g.mainId,
          name: g.mainInd,
          targetLabel: g.mainTarget,
          depId: g.mainDepId,
          issueTitle: issue.title,
          // สำหรับแสดง/ซ่อน items
          showItems: false,
          items: [],
          itemsLoading: false,
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
      },
    });
  }

  // โหลด 31 items สำหรับ main indicator ตัวหนึ่ง
  loadMainIndItems(mainInd: any) {
    if (mainInd.showItems && mainInd.items.length > 0) {
      // ถ้า load แล้ว ให้ซ่อนไป
      mainInd.showItems = false;
      return;
    }

    mainInd.itemsLoading = true;
    mainInd.showItems = true;

    // ดึงข้อมูล items ที่link ถึง main indicator นี้
    this.api.getMainIndicatorItems(mainInd.id).subscribe({
      next: (res: any) => {
        if (res.success) {
          mainInd.items = res.data.map((item: any) => ({
            ...item,
            // สำหรับแก้ไขค่า
            monthValues: {},
          }));

          // โหลดค่าที่บันทึกไว้สำหรับแต่ละ item เดือน
          this.loadMainIndItemValues(mainInd);
        }
        mainInd.itemsLoading = false;
        this.cd.detectChanges();
      },
      error: () => {
        mainInd.itemsLoading = false;
        Swal.fire({ icon: 'error', title: 'โหลดข้อมูล items ไม่สำเร็จ' });
      },
    });
  }

  // โหลดค่าของแต่ละ item
  loadMainIndItemValues(mainInd: any) {
    this.api
      .getMainRecordsItems(this.fiscalYear, this.selectedMainIndAmphoe || undefined, mainInd.id)
      .subscribe({
        next: (res: any) => {
          if (res.success) {
            // จัดเรียงข้อมูลเป็น map: item_id -> { month -> value }
            const itemValuesMap: { [key: number]: { [key: number]: any } } = {};
            res.data.forEach((record: any) => {
              if (record.item_id) {
                if (!itemValuesMap[record.item_id]) itemValuesMap[record.item_id] = {};
                itemValuesMap[record.item_id][record.report_month] = record.kpi_value;
              }
            });

            // เติมค่าเข้าไปใน items
            mainInd.items.forEach((item: any) => {
              item.monthValues = itemValuesMap[item.id] || {};
            });
          }
          this.cd.detectChanges();
        },
      });
  }

  // ดึงค่า item สำหรับเดือนที่ระบุ
  getMainIndItemValue(mainInd: any, item: any, month: number): any {
    return item.monthValues && item.monthValues[month] !== undefined ? item.monthValues[month] : '';
  }

  // อัพเดตค่า item เมื่อมีการแก้ไข
  onMainIndItemValueChange(mainInd: any, item: any, month: number, event: any) {
    let val = event.target.value;
    if (val === '') val = null;
    else {
      val = parseFloat(val);
      if (val < 0) {
        val = 0;
        event.target.value = 0;
        Swal.fire({
          icon: 'warning',
          title: 'ไม่อนุญาตค่าติดลบ',
          timer: 2000,
          showConfirmButton: false,
        });
      }
    }

    if (!item.monthValues) item.monthValues = {};
    item.monthValues[month] = val;

    // ทำเครื่องหมายว่ามีการเปลี่ยน
    const key = `${mainInd.id}_item_${item.id}_${month}`;
    const originalVal = this.mainIndOriginalMap[key];
    if (originalVal === val || (originalVal === undefined && val === null)) {
      delete this.mainIndChangedCells[key];
    } else {
      this.mainIndChangedCells[key] = 'same';
    }

    const idx = this.mainIndPendingChanges.findIndex(
      (c) => c.main_ind_id === mainInd.id && c.item_id === item.id && c.month === month,
    );
    if (idx > -1) this.mainIndPendingChanges.splice(idx, 1);
    if (originalVal !== val) {
      this.mainIndPendingChanges.push({
        main_ind_id: mainInd.id,
        item_id: item.id,
        month,
        value: val,
      });
    }
  }

  onMainIndAmphoeChange() {
    this.mainIndPendingChanges = [];
    this.mainIndChangedCells = {};
    this.isMainIndEditing = false;
    this.mainIndicators.forEach((m) => {
      m.showItems = false;
      m.items = [];
    });
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

    // แยก changes เป็น 2 กลุ่ม: aggregate values และ item-level values
    const aggregateChanges = this.mainIndPendingChanges.filter((c) => !c.item_id);
    const itemChanges = this.mainIndPendingChanges.filter((c) => c.item_id);

    let savedCount = 0;

    // บันทึกค่า aggregate ก่อน
    const saveAggregatePromise =
      aggregateChanges.length > 0
        ? this.api
            .saveMainRecordsBatch({
              fiscalYear: this.fiscalYear,
              amphoe_name: this.selectedMainIndAmphoe,
              changes: aggregateChanges,
            })
            .toPromise()
        : Promise.resolve({ success: true, count: 0 });

    // บันทึก item-level data
    const saveItemsPromise =
      itemChanges.length > 0
        ? this.api
            .saveMainRecordsItemsBatch({
              fiscalYear: this.fiscalYear,
              amphoe_name: this.selectedMainIndAmphoe,
              changes: itemChanges,
            })
            .toPromise()
        : Promise.resolve({ success: true, count: 0 });

    Promise.all([saveAggregatePromise, saveItemsPromise])
      .then((results: any[]) => {
        const aggResult = results[0];
        const itemResult = results[1];

        if (aggResult.success || itemResult.success) {
          savedCount = (aggResult.count || 0) + (itemResult.count || 0);
          Swal.fire({
            icon: 'success',
            title: 'บันทึกสำเร็จ!',
            text: `บันทึกข้อมูลเรียบร้อย ${savedCount} รายการ`,
            timer: 2000,
            showConfirmButton: false,
          });
          this.mainIndPendingChanges = [];
          this.mainIndChangedCells = {};
          this.isMainIndEditing = false;
          Object.assign(this.mainIndOriginalMap, this.mainIndDataMap);
          // reload data
          this.loadMainIndData();
        } else {
          Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่',
          });
        }
      })
      .catch(() => {
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่',
        });
      });
  }
}
