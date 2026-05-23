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
  // View Mode: 'summary' = ภาพรวมหน่วยงาน, 'detail' = รายงานละเอียด
  viewMode: 'summary' | 'detail' = 'summary';
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
    this.loadSummaryData();
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
    // 3. ค้นหา
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
  switchMode(mode: 'summary' | 'detail') {
    this.viewMode = mode;
    if (mode === 'summary') this.loadSummaryData();
    else {
        this.currentPage = 1;
        this.loadReportData();
    }
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