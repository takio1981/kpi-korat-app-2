import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../services/api';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExportService } from '../services/export.service';
import Swal from 'sweetalert2';
import { NavbarComponent } from '../shared/navbar/navbar';
import { isAdminRole } from '../guards/auth.guard';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './admin-dashboard.html'
})
export class AdminDashboardComponent implements OnInit {
  // Config
  fiscalYear = 2569;
  availableYears = [2566, 2567, 2568, 2569, 2570];
  currentDate = new Date();
  // View Mode: 'monitor' เป็น default
  viewMode: 'summary' | 'detail' | 'monitor' = 'monitor';
  // Data View Mode: โหมดดูข้อมูล (หน่วยบริการ/อำเภอ) — ส่งต่อไป provincial-kpi ผ่าน localStorage
  dataViewMode: 'hospital' | 'amphoe' = 'hospital';

  // Filters (cascading)
  amphoes: string[] = [];
  selectedAmphoe = 'ทั้งหมด';

  allHospitals: any[] = [];   // ข้อมูลหน่วยบริการทั้งหมดจาก summaryData
  filteredHospitals: any[] = [];
  selectedHospital = 'all';

  departments: any[] = [];
  selectedDepartment = 'all';

  issues: any[] = [];
  selectedIssue = 'all';

  allMains: any[] = [];       // ตัวชี้วัดหลักทั้งหมด
  filteredMains: any[] = [];
  allItems: any[] = [];       // รายการ KPI ทั้งหมด
  selectedItem = 'all';

  searchText = '';
  filterCollapsed = false;
  summaryViewBy: 'hospital' | 'amphoe' = 'hospital';

  // Monitor view
  monitorSubView: 'summary' | 'pivot' = 'summary';
  monitorData: any[] = [];
  filteredMonitorData: any[] = [];
  monitorStatusFilter: 'all' | 'has_data' | 'no_data' = 'all';
  monitorSearchText = '';
  monitorAmphoeFilter: Set<string> = new Set();
  monitorUnitTypeFilter: Set<string> = new Set(['รพ.', 'สสอ.', 'รพ.สต.']);
  monitorAmphoeDropdownOpen = false;
  monitorUnitTypeDropdownOpen = false;

  // Monitor Pivot — multi-select + monthly breakdown
  pivotColumns: any[] = [];
  pivotData: any[] = [];
  filteredPivotData: any[] = [];
  pivotMonthHeaders: any[] = [];   // month headers returned from API
  selectedMonitorIssues: Set<number> = new Set();
  selectedMonitorItems: Set<number> = new Set();
  issueDropdownOpen = false;
  itemDropdownOpen = false;
  pivotLoading = false;
  pivotMonthCount = 4;             // จำนวนเดือนที่แสดง
  amphoeSummary: any[] = [];
  filteredAmphoeSummary: any[] = [];
  selectedUnitType = 'all';
  unitTypes = ['รพ.สต.', 'รพ.', 'สสอ.', 'อื่นๆ'];
  toggleFilter() { this.filterCollapsed = !this.filterCollapsed; }

  // เพิ่มตัวแปร Pagination สำหรับหน้า Summary
  summaryPage = 1;
  summaryLimit = 15; // แสดง 15 แถวต่อหน้า

  // Data
  summaryData: any[] = [];    // ข้อมูลหน้า Summary
  filteredSummary: any[] = [];
  filteredReport: any[] = [];

  reportData: any[] = [];     // ข้อมูลหน้า Detail
  
  // Pagination (สำหรับหน้า Detail)
  currentPage = 1;
  itemsPerPage = 15;
  totalItems = 0;
  totalPages = 0;
  rowsOptions = [15, 30, 50, 100];

  constructor(
    private api: ApiService, 
    private router: Router, 
    private cd: ChangeDetectorRef,
    private exportService: ExportService
  ) {}
 
  get filteredMonitorItems() {
    if (this.selectedMonitorIssues.size === 0) return this.allItems;
    const mainIds = this.allMains
      .filter((m: any) => this.selectedMonitorIssues.has(Number(m.issue_id)))
      .map((m: any) => m.id);
    return this.allItems.filter((it: any) => mainIds.includes(it.main_ind_id));
  }

  get selectedIssuesLabel(): string {
    const n = this.selectedMonitorIssues.size;
    if (n === 0) return '-- เลือกประเด็น --';
    if (n === this.issues.length && n > 0) return `ทั้งหมด (${n} รายการ)`;
    return `เลือก ${n} รายการ`;
  }

  get selectedAmphoesLabel(): string {
    const n = this.monitorAmphoeFilter.size;
    if (n === 0) return '-- เลือกอำเภอ --';
    if (n === this.amphoes.length && n > 0) return `ทั้งหมด (${n} อำเภอ)`;
    return `เลือก ${n} อำเภอ`;
  }

  get selectedUnitTypesLabel(): string {
    const n = this.monitorUnitTypeFilter.size;
    const totalTypes = 3; // รพ., สสอ., รพ.สต.
    if (n === 0) return '-- เลือกประเภท --';
    if (n === totalTypes) return `ทั้งหมด (${n} ประเภท)`;
    return `เลือก ${n} ประเภท`;
  }

  get selectedItemsLabel(): string {
    const n = this.selectedMonitorItems.size;
    if (n === 0) return '-- เลือกตัวชี้วัด --';
    if (n === this.filteredMonitorItems.length && n > 0) return `ทั้งหมด (${n} รายการ)`;
    return `เลือก ${n} รายการ`;
  }

  // Pivot stats: ผู้ที่มีข้อมูลเดือนล่าสุด (current month = pivotMonthHeaders[0])
  get pivotCurrentMonthKey(): number {
    return this.pivotMonthHeaders[0]?.key || 0;
  }

  getPivotKpi(row: any, colId: number): { target: number; months: { [k: number]: number } } {
    return (row.kpis && row.kpis[colId]) ? row.kpis[colId] : { target: 0, months: {} };
  }

  getPivotKpiMonth(row: any, colId: number, monthKey: number): number | null {
    const kpi = row.kpis && row.kpis[colId];
    if (!kpi || !kpi.months) return null;
    const v = kpi.months[monthKey];
    return v !== undefined ? v : null;
  }

  get monitorRphStats() {
    const units = this.monitorData.filter(r => r.unit_type === 'รพ.');
    return { total: units.length, has: units.filter(r => r.has_data).length, no: units.filter(r => !r.has_data).length };
  }
  get monitorSsaoStats() {
    const units = this.monitorData.filter(r => r.unit_type === 'สสอ.');
    return { total: units.length, has: units.filter(r => r.has_data).length, no: units.filter(r => !r.has_data).length };
  }
  get monitorAmphoeStats() {
    const amphoeMap: { [k: string]: boolean[] } = {};
    this.monitorData.forEach(r => {
      if (!amphoeMap[r.amphoe_name]) amphoeMap[r.amphoe_name] = [];
      amphoeMap[r.amphoe_name].push(r.has_data);
    });
    const entries = Object.entries(amphoeMap);
    const hasAll = entries.filter(([, statuses]) => statuses.every(s => s)).length;
    return { total: entries.length, has: hasAll, no: entries.length - hasAll };
  }

  // Getter สำหรับดึงข้อมูลเฉพาะหน้าปัจจุบันมาแสดง
  get paginatedSummaryData() {
    const startIndex = (this.summaryPage - 1) * this.summaryLimit;
    return this.filteredSummary.slice(startIndex, startIndex + this.summaryLimit);
  }

  // Getter คำนวณจำนวนหน้าทั้งหมด
  get totalSummaryPages() {
    return Math.ceil(this.filteredSummary.length / this.summaryLimit);
  }

  currentUser: any = {};

  ngOnInit() {
    this.currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    if (!isAdminRole(this.currentUser.role)) {
      this.router.navigate(['/login']);
      return;
    }

    // admin_cup: ล็อกอำเภอตัวเอง
    if (this.currentUser.role === 'admin_cup' && this.currentUser.amphoe_name) {
      this.selectedAmphoe = this.currentUser.amphoe_name;
    }

    this.loadFilters();
    this.loadKpiOptions();
    this.loadMonitorData();
  }

  // --- Load Option Data ---
  loadFilters() {
    this.api.getAmphoes().subscribe((res: any) => {
      if (res.success) this.amphoes = res.data;
    });
  }

  loadKpiOptions() {
    this.api.get('admin/kpi-options').subscribe((res: any) => {
      if (res.success) {
        this.issues = res.issues || [];
        this.allMains = res.mains || [];
        this.filteredMains = [...this.allMains];
        this.allItems = res.items || [];
        this.departments = res.departments || [];
      }
    });
  }

  // --- Cascading filter logic ---
  onAmphoeChange() {
    // เมื่อเลือกอำเภอ → กรองหน่วยบริการ
    this.selectedHospital = 'all';
    this.updateFilteredHospitals();
    this.applySummaryFilters();
  }

  onHospitalChange() {
    this.applySummaryFilters();
  }

  onDepartmentChange() {
    // เมื่อเลือกกลุ่มงาน → กรองตัวชี้วัดหลัก
    this.selectedIssue = 'all';
    this.selectedItem = 'all';
    if (this.selectedDepartment === 'all') {
      this.filteredMains = [...this.allMains];
    } else {
      const depId = parseInt(this.selectedDepartment);
      this.filteredMains = this.allMains.filter((m: any) => m.dep_id === depId || !m.dep_id);
    }
    this.applySummaryFilters();
  }

  onIssueChange() {
    this.selectedItem = 'all';
    this.applySummaryFilters();
  }

  updateFilteredHospitals() {
    if (this.selectedAmphoe === 'ทั้งหมด') {
      this.filteredHospitals = [...this.allHospitals];
    } else {
      this.filteredHospitals = this.allHospitals.filter(h => h.amphoe_name === this.selectedAmphoe);
    }
  }

  // --- Summary View Logic ---
  loadSummaryData() {
    this.api.getAdminSummary(this.fiscalYear, '').subscribe((res: any) => {
      if (res.success) {
        this.summaryData = res.data;
        // สร้างรายชื่อหน่วยบริการจากข้อมูล
        this.allHospitals = res.data.map((r: any) => ({
          id: r.id, hospital_name: r.hospital_name, amphoe_name: r.amphoe_name, hospcode: r.hospcode
        }));
        this.updateFilteredHospitals();
        this.applySummaryFilters();
      }
      this.cd.detectChanges();
    });
  }

  applySummaryFilters() {
    let temp = this.summaryData;

    // 1. กรองอำเภอ
    if (this.selectedAmphoe !== 'ทั้งหมด') {
      temp = temp.filter(row => row.amphoe_name === this.selectedAmphoe);
    }
    // 2. กรองหน่วยบริการ
    if (this.selectedHospital !== 'all') {
      const hId = parseInt(this.selectedHospital);
      temp = temp.filter(row => row.id === hId);
    }
    // 3. กรองประเภทหน่วยบริการ
    if (this.selectedUnitType !== 'all') {
      temp = temp.filter(row => this.getUnitType(row.hospital_name) === this.selectedUnitType);
    }
    // 4. ค้นหา
    if (this.searchText) {
      const search = this.searchText.toLowerCase();
      temp = temp.filter(row =>
        (row.hospital_name && row.hospital_name.toLowerCase().includes(search)) ||
        (row.hospcode && row.hospcode.toLowerCase().includes(search))
      );
    }
    // เรียงลำดับ: หน่วยงานที่มีข้อมูลแล้ว (recorded) จากมากไปหาน้อย
    // tiebreaker: progress สูงกว่า มาก่อน → แล้วชื่อหน่วยงาน
    temp = [...temp].sort((a, b) => {
      const ar = +a.recorded || 0, br = +b.recorded || 0;
      if (br !== ar) return br - ar;
      const ap = +a.progress || 0, bp = +b.progress || 0;
      if (bp !== ap) return bp - ap;
      return (a.hospital_name || '').localeCompare(b.hospital_name || '', 'th');
    });
    this.filteredSummary = temp;
    this.summaryPage = 1;
    if (this.summaryViewBy === 'amphoe') this.buildAmphoeSummary();
  }

  // --- Detailed Report Logic (Pagination) ---
  loadReportData() {
    // สร้าง Query String เอง หรือเพิ่มใน ApiService
    const params = `?fiscalYear=${this.fiscalYear}&amphoe=${this.selectedAmphoe}&issueId=${this.selectedIssue}&itemId=${this.selectedItem}&page=${this.currentPage}&limit=${this.itemsPerPage}`;
    
    this.api.get(`admin/report${params}`).subscribe((res: any) => {
      if (res.success) {
        this.reportData = res.data;
        this.totalItems = res.total;
        this.totalPages = Math.ceil(this.totalItems / this.itemsPerPage);
        this.filteredReport = [...this.reportData];
      }
      this.cd.detectChanges();
    });
  }

  onPageChange(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.loadReportData();
    }
  }

  onLimitChange() {
    this.currentPage = 1; // กลับไปหน้า 1 เสมอเมื่อเปลี่ยนจำนวนแถว
    this.loadReportData();
  }

  // --- Utility ---
  switchMode(mode: 'summary' | 'detail' | 'monitor') {
    this.viewMode = mode;
    if (mode === 'summary') this.loadSummaryData();
    else if (mode === 'detail') {
        this.currentPage = 1;
        this.loadReportData();
    } else if (mode === 'monitor') {
        this.loadMonitorData();
    }
  }

  loadMonitorData() {
    this.api.getAdminMonitor(this.fiscalYear).subscribe((res: any) => {
      if (res.success) {
        this.monitorData = res.data;
        this.applyMonitorFilters();
      }
      this.cd.detectChanges();
    });
  }

  applyMonitorFilters() {
    let temp = [...this.monitorData];
    if (this.currentUser.role === 'admin_cup' && this.currentUser.amphoe_name) {
      temp = temp.filter(r => r.amphoe_name === this.currentUser.amphoe_name);
    } else if (this.monitorAmphoeFilter.size > 0) {
      temp = temp.filter(r => this.monitorAmphoeFilter.has(r.amphoe_name));
    }
    if (this.monitorUnitTypeFilter.size > 0) {
      temp = temp.filter(r => this.monitorUnitTypeFilter.has(r.unit_type));
    }
    if (this.monitorStatusFilter === 'has_data') temp = temp.filter(r => r.has_data);
    else if (this.monitorStatusFilter === 'no_data') temp = temp.filter(r => !r.has_data);
    if (this.monitorSearchText) {
      const s = this.monitorSearchText.toLowerCase();
      temp = temp.filter(r =>
        (r.hospital_name || '').toLowerCase().includes(s) ||
        (r.hospcode || '').toLowerCase().includes(s) ||
        (r.amphoe_name || '').toLowerCase().includes(s)
      );
    }
    temp.sort((a, b) => {
      if (a.amphoe_name !== b.amphoe_name) return (a.amphoe_name || '').localeCompare(b.amphoe_name || '', 'th');
      if (a.unit_type !== b.unit_type) return (a.unit_type || '').localeCompare(b.unit_type || '', 'th');
      return (a.hospital_name || '').localeCompare(b.hospital_name || '', 'th');
    });
    this.filteredMonitorData = temp;
  }

  switchMonitorSubView(mode: 'summary' | 'pivot') {
    this.monitorSubView = mode;
    if (mode === 'summary') this.loadMonitorData();
  }

  applyCurrentMonitorFilters() {
    if (this.monitorSubView === 'summary') this.applyMonitorFilters();
    else this.applyPivotFilters();
  }

  onMonitorIssueChange() {
    this.selectedMonitorItems.clear();
    this.itemDropdownOpen = false;
  }

  toggleMonitorIssue(issueId: number) {
    if (this.selectedMonitorIssues.has(issueId)) this.selectedMonitorIssues.delete(issueId);
    else this.selectedMonitorIssues.add(issueId);
  }

  toggleAllMonitorIssues() {
    if (this.selectedMonitorIssues.size === this.issues.length) {
      this.selectedMonitorIssues.clear();
    } else {
      this.issues.forEach((iss: any) => this.selectedMonitorIssues.add(iss.id));
    }
  }

  toggleMonitorItem(id: number) {
    if (this.selectedMonitorItems.has(id)) this.selectedMonitorItems.delete(id);
    else this.selectedMonitorItems.add(id);
  }

  toggleAllMonitorItems() {
    if (this.selectedMonitorItems.size === this.filteredMonitorItems.length) {
      this.selectedMonitorItems.clear();
    } else {
      this.filteredMonitorItems.forEach((it: any) => this.selectedMonitorItems.add(it.id));
    }
  }

  toggleMonitorAmphoe(amphoe: string) {
    if (this.monitorAmphoeFilter.has(amphoe)) this.monitorAmphoeFilter.delete(amphoe);
    else this.monitorAmphoeFilter.add(amphoe);
    this.applyCurrentMonitorFilters();
  }

  toggleAllMonitorAmphoes() {
    if (this.monitorAmphoeFilter.size === this.amphoes.length) {
      this.monitorAmphoeFilter.clear();
    } else {
      this.amphoes.forEach((a: string) => this.monitorAmphoeFilter.add(a));
    }
    this.applyCurrentMonitorFilters();
  }

  toggleMonitorUnitType(unitType: string) {
    if (this.monitorUnitTypeFilter.has(unitType)) this.monitorUnitTypeFilter.delete(unitType);
    else this.monitorUnitTypeFilter.add(unitType);
    this.applyCurrentMonitorFilters();
  }

  toggleAllMonitorUnitTypes() {
    const unitTypes = ['รพ.', 'สสอ.', 'รพ.สต.'];
    if (this.monitorUnitTypeFilter.size === 3) {
      this.monitorUnitTypeFilter.clear();
    } else {
      unitTypes.forEach(t => this.monitorUnitTypeFilter.add(t));
    }
    this.applyCurrentMonitorFilters();
  }

  loadPivotData() {
    const itemIds = Array.from(this.selectedMonitorItems);
    const issueIds = Array.from(this.selectedMonitorIssues);
    if (issueIds.length === 0 && itemIds.length === 0) {
      Swal.fire({ icon: 'info', title: 'กรุณาเลือกตัวกรอง', text: 'โปรดเลือกประเด็นหรือตัวชี้วัดก่อน', confirmButtonColor: '#6366f1' });
      return;
    }
    this.pivotLoading = true;
    this.pivotColumns = [];
    this.pivotMonthHeaders = [];
    this.filteredPivotData = [];
    this.itemDropdownOpen = false;
    this.api.getAdminMonitorPivot(this.fiscalYear, issueIds, itemIds, this.pivotMonthCount)
      .subscribe((res: any) => {
        this.pivotLoading = false;
        if (res.success) {
          this.pivotColumns = res.columns;
          this.pivotMonthHeaders = res.monthHeaders || [];
          this.pivotData = res.data;
          console.log('[pivot] columns:', res.columns?.map((c: any) => ({id: c.id, name: c.name})));
          console.log('[pivot] monthHeaders:', res.monthHeaders);
          console.log('[pivot] _debug:', res._debug);
          if (res.data?.length > 0) {
            const sample = res.data[0];
            console.log('[pivot] data[0].kpis:', JSON.stringify(sample.kpis));
          }
          this.applyPivotFilters();
        }
        this.cd.detectChanges();
      });
  }

  applyPivotFilters() {
    let temp = [...this.pivotData];
    if (this.currentUser.role === 'admin_cup' && this.currentUser.amphoe_name) {
      temp = temp.filter(r => r.amphoe_name === this.currentUser.amphoe_name);
    } else if (this.monitorAmphoeFilter.size > 0) {
      temp = temp.filter(r => this.monitorAmphoeFilter.has(r.amphoe_name));
    }
    if (this.monitorUnitTypeFilter.size > 0) temp = temp.filter(r => this.monitorUnitTypeFilter.has(r.unit_type));
    if (this.monitorStatusFilter === 'has_data') temp = temp.filter(r => r.has_data);
    else if (this.monitorStatusFilter === 'no_data') temp = temp.filter(r => !r.has_data);
    if (this.monitorSearchText) {
      const s = this.monitorSearchText.toLowerCase();
      temp = temp.filter(r =>
        (r.hospital_name || '').toLowerCase().includes(s) ||
        (r.hospcode || '').toLowerCase().includes(s) ||
        (r.amphoe_name || '').toLowerCase().includes(s)
      );
    }
    temp.sort((a, b) => {
      if (a.amphoe_name !== b.amphoe_name) return (a.amphoe_name || '').localeCompare(b.amphoe_name || '', 'th');
      if (a.unit_type !== b.unit_type) return (a.unit_type || '').localeCompare(b.unit_type || '', 'th');
      return (a.hospital_name || '').localeCompare(b.hospital_name || '', 'th');
    });
    this.filteredPivotData = temp;
  }

  get pivotMonthLabels(): string {
    return this.pivotMonthHeaders.map((h: any) => h.label).join(', ');
  }

  private buildMonitorExportRow(row: any, index: number) {
    return {
      'ลำดับ': index + 1,
      'รหัส': row.hospcode || row.username,
      'อำเภอ': row.amphoe_name,
      'ประเภท': row.unit_type,
      'หน่วยบริการ': row.hospital_name,
      'ผ่านเป้าหมาย (%)': (row.passed_percent ?? row.progress).toFixed(1) + '%',
      'KPI ผ่าน': row.kpis_passed ?? '-',
      'KPI บันทึกแล้ว': row.recorded,
      'KPI ทั้งหมด': row.total_kpis,
      'สถานะ': row.has_data ? 'มีข้อมูล' : 'ไม่มีข้อมูล',
      'อัปเดตล่าสุด': row.last_update ? new Date(row.last_update).toLocaleString('th-TH') : '-'
    };
  }

  exportMonitorExcel() {
    if (!this.filteredMonitorData.length) return;
    const data = this.filteredMonitorData.map((r, i) => this.buildMonitorExportRow(r, i));
    this.exportService.exportToExcel(data, `Monitor_รพ_สสอ_${this.fiscalYear}_${new Date().toISOString().slice(0, 10)}`, 'Monitor');
  }

  exportMonitorAllExcel() {
    if (!this.monitorData.length) return;
    const data = this.monitorData.map((r, i) => this.buildMonitorExportRow(r, i));
    this.exportService.exportToExcel(data, `Monitor_รพ_สสอ_ทั้งหมด_${this.fiscalYear}_${new Date().toISOString().slice(0, 10)}`, 'Monitor');
  }

  private buildPivotExportRow(row: any, index: number) {
    const obj: any = {
      'ลำดับ': index + 1,
      'รหัส': row.hospcode || row.username,
      'อำเภอ': row.amphoe_name,
      'ประเภท': row.unit_type,
      'หน่วยบริการ': row.hospital_name,
    };
    this.pivotColumns.forEach((col: any) => {
      const kpi = this.getPivotKpi(row, col.id);
      obj[`${col.name} | เป้าหมาย`] = kpi.target;
      this.pivotMonthHeaders.forEach((h: any) => {
        const v = this.getPivotKpiMonth(row, col.id, h.key);
        obj[`${col.name} | ${h.label}`] = v !== null ? v : '-';
      });
    });
    obj['สถานะ'] = row.has_data ? 'มีข้อมูล' : 'ไม่มีข้อมูล';
    return obj;
  }

  exportPivotExcel() {
    if (!this.filteredPivotData.length || !this.pivotColumns.length) return;
    const data = this.filteredPivotData.map((r, i) => this.buildPivotExportRow(r, i));
    this.exportService.exportToExcel(data, `Monitor_KPI_Pivot_${this.fiscalYear}_${new Date().toISOString().slice(0, 10)}`, 'Pivot');
  }

  exportPivotAllExcel() {
    if (!this.pivotData.length || !this.pivotColumns.length) return;
    const data = this.pivotData.map((r, i) => this.buildPivotExportRow(r, i));
    this.exportService.exportToExcel(data, `Monitor_KPI_Pivot_ทั้งหมด_${this.fiscalYear}_${new Date().toISOString().slice(0, 10)}`, 'Pivot');
  }

  getPercentage(target: number, result: number): number {
    if (!target || target === 0) return 0;
    return (result / target) * 100;
  }

  // Drill-down Logic (เหมือนเดิม)
  viewHospitalDashboard(hospital: any) {
    const adminUser = localStorage.getItem('currentUser');
    const mockUser = {
      id: hospital.id,
      hospcode: hospital.hospcode || hospital.username, 
      hospital_name: hospital.hospital_name,
      amphoe_name: hospital.amphoe_name,
      role: 'user',
      isAdminView: true
    };
    localStorage.setItem('currentUser', JSON.stringify(mockUser));
    localStorage.setItem('adminSession', adminUser!);
    localStorage.setItem('adminSelectedYear', this.fiscalYear.toString());
    this.router.navigate(['/dashboard']);
  }

  // เพิ่มฟังก์ชันเปลี่ยนหน้า
  changeSummaryPage(page: number) {
    if (page >= 1 && page <= this.totalSummaryPages) {
      this.summaryPage = page;
    }
  }

  onSummaryLimitChange() {
    this.summaryPage = 1;
  }

  getUnitType(hospitalName: string): string {
    const n = (hospitalName || '').trim();
    if (n.includes('โรงพยาบาลส่งเสริมสุขภาพตำบล')) return 'รพ.สต.';
    if (n.includes('โรงพยาบาล')) return 'รพ.';
    if (n.includes('สำนักงานสาธารณสุขอำเภอ') || n.includes('สาธารณสุขอำเภอ')) return 'สสอ.';
    return 'อื่นๆ';
  }

  onUnitTypeChange() {
    this.selectedHospital = 'all';
    this.updateFilteredHospitals();
    this.applySummaryFilters();
  }

  switchSummaryView(mode: 'hospital' | 'amphoe') {
    this.summaryViewBy = mode;
    if (mode === 'amphoe') this.buildAmphoeSummary();
  }

  buildAmphoeSummary() {
    const myAmphoe = this.currentUser.amphoe_name?.trim();
    let source = (this.currentUser.role === 'admin_cup' && myAmphoe)
      ? this.summaryData.filter((r: any) => (r.amphoe_name || '').trim() === myAmphoe)
      : this.summaryData;

    if (this.selectedUnitType !== 'all') {
      source = source.filter((r: any) => this.getUnitType(r.hospital_name) === this.selectedUnitType);
    }

    const map: { [key: string]: any } = {};
    source.forEach((row: any) => {
      const key = (row.amphoe_name || 'ไม่ระบุ').trim();
      if (!map[key]) {
        map[key] = {
          amphoe_name: key,
          total_hospitals: 0,
          recorded_hospitals: 0,
          total_kpis: 0,
          recorded: 0,
          not_recorded: 0,
          last_update: null
        };
      }
      const a = map[key];
      a.total_hospitals++;
      if ((row.recorded || 0) > 0) a.recorded_hospitals++;
      a.total_kpis += row.total_kpis || 0;
      a.recorded += row.recorded || 0;
      a.not_recorded += row.not_recorded || 0;
      if (row.last_update && (!a.last_update || new Date(row.last_update) > new Date(a.last_update))) {
        a.last_update = row.last_update;
      }
    });

    let result = Object.values(map).map((a: any) => ({
      ...a,
      progress: a.total_kpis > 0 ? (a.recorded / a.total_kpis) * 100 : 0
    }));

    if (this.searchText) {
      const s = this.searchText.toLowerCase();
      result = result.filter((a: any) => a.amphoe_name.toLowerCase().includes(s));
    }

    this.filteredAmphoeSummary = result.sort((a: any, b: any) => b.progress - a.progress);
  }

  drillDownAmphoe(amphoeName: string) {
    this.summaryViewBy = 'hospital';
    this.selectedAmphoe = amphoeName;
    this.updateFilteredHospitals();
    this.applySummaryFilters();
  }

// --- 3. เพิ่มฟังก์ชัน Export Excel ---
  exportExcel() {
    // เตรียมข้อมูลใหม่ (Mapping) ให้เป็นภาษาไทยและ format สวยงาม
    const dataToExport = this.filteredSummary.map((row, index) => ({
      'ลำดับ': index + 1,
      'รหัสหน่วยบริการ': row.hospcode || row.username,
      'อำเภอ': row.amphoe_name,
      'หน่วยงาน': row.hospital_name,
      'บันทึกแล้ว (ตัว)': row.recorded,
      'ยังไม่บันทึก (ตัว)': row.not_recorded,
      'ความก้าวหน้า (%)': `${row.progress.toFixed(2)}%`,
      'อัปเดตล่าสุด': row.last_update ? new Date(row.last_update).toLocaleString('th-TH') : '-'
    }));

    // ส่งออกไฟล์
    const fileName = `รายงานผลการดำเนินงาน_${this.fiscalYear}_${new Date().toISOString().slice(0,10)}`;
    this.exportService.exportToExcel(dataToExport, fileName, 'สรุปผลงาน');
  }

  // --- 4. เพิ่มฟังก์ชัน Export PDF ---
  exportPdf() {
    const fileName = `Report_${this.fiscalYear}`;
    // 'summary-table' คือ id ของ div ที่เราจะใส่ใน HTML (ขั้นตอนถัดไป)
    this.exportService.exportToPdf('summary-table', fileName, `สรุปผลการดำเนินงาน ปีงบประมาณ ${this.fiscalYear}`);
  }

  // --- 5. ฟังก์ชัน Export Excel (หน้าละเอียด) ---
  exportDetailExcel() {
    if (!this.filteredReport || this.filteredReport.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่พบข้อมูล',
        text: 'ไม่มีข้อมูลสำหรับส่งออก หรือยังไม่ได้เลือกเงื่อนไข',
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }

    const dataToExport = this.filteredReport.map((row: any, index: number) => {
      // 1. ดึงค่าและแปลงเป็นตัวเลข (เพื่อให้คำนวณได้)
      const target = parseFloat(row.target || row.target_value || 0);
      const result = parseFloat(row.result || row.result_value || 0);
      
      // 2. คำนวณเปอร์เซ็นต์ (ถ้าเป้าหมายมากกว่า 0 ถึงจะหาร)
      let percent = 0;
      if (target > 0) {
        percent = (result / target) * 100;
      }

      return {
        'ลำดับ': index + 1,
        'ปีงบประมาณ': row.fiscal_year,
        'รหัสหน่วยบริการ': row.hospcode,
        'อำเภอ': row.amphoe_name,
        'หน่วยงาน': row.hospital_name,
        'ตัวชี้วัด': row.item_name || row.issue_name || row.label || '-', 
        
        'เป้าหมาย': target,  // ใช้ค่าที่แปลงเป็นตัวเลขแล้ว
        'ผลงาน': result,    // ใช้ค่าที่แปลงเป็นตัวเลขแล้ว
        
        // 3. ใส่ค่าที่คำนวณเสร็จแล้วลงไป
        'ร้อยละความสำเร็จ': `${percent.toFixed(2)}%`,

        'วันที่อัปเดต': row.last_update ? new Date(row.last_update).toLocaleString('th-TH') : '-'
      };
    });

    const fileName = `รายงานละเอียด_${this.fiscalYear}_${new Date().toISOString().slice(0,10)}`;
    this.exportService.exportToExcel(dataToExport, fileName, 'ข้อมูลละเอียด');
  }

    // (แถม) ฟังก์ชันแปลงเลขเดือนเป็นชื่อ (ถ้ายังไม่มีในไฟล์นี้)
    getMonthName(month: number): string {
      const months = [
        'เป้าหมาย', 'ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 
        'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'
      ];
      return months[month] || '-';
    }


  // ส่งออกรายงาน Excel ทั้งหมดจาก Server (สูงสุด 5,000 แถว)
  exportReportExcel() {
    Swal.fire({ title: 'กำลังสร้างไฟล์...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    this.api.downloadReportExcel(this.fiscalYear, this.selectedAmphoe, this.selectedIssue, this.selectedItem)
      .subscribe({
        next: (blob: Blob) => {
          Swal.close();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `kpi_report_${this.fiscalYear}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: () => {
          Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถดาวน์โหลดไฟล์ได้' });
        }
      });
  }

  logout() {
    localStorage.removeItem('currentUser');
    this.router.navigate(['/login']);
  }
}