import { NgChartsModule } from 'ng2-charts';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core'; 
import { ApiService } from '../services/api';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import Swal from 'sweetalert2';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { NavbarComponent } from '../shared/navbar/navbar';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, NgChartsModule, RouterLink, RouterLinkActive, NavbarComponent],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent implements OnInit {
  kpiStructure: any[] = [];
  dataMap: { [key: string]: any } = {};
  originalDataMap: { [key: string]: any } = {}; // เก็บค่าเดิมจาก DB สำหรับเปรียบเทียบ
  changedCells: { [key: string]: 'up' | 'down' | 'same' } = {}; // ไฮไลท์ช่องที่เปลี่ยน

  fiscalYear = 2569;
  availableYears = [2566, 2567, 2568, 2569, 2570];
  months = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  pendingChanges: any[] = [];
  currentUser: any = null;
  isLoading = true;
  isEditing = false; // ล็อกตารางไม่ให้แก้ไขจนกว่าจะกดปุ่ม
  // 3. ตัวแปรสำหรับ Modal กราฟ
  showChartModal = false;
  currentChartTitle = '';
  // 4. การตั้งค่ากราฟ (Bar Chart ผสม Line)
  public chartData: ChartConfiguration<'bar' | 'line'>['data'] = {
    labels: [],
    datasets: []
  };

  public chartOptions: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'bottom' },
    }
  };

// ตัวแปรสำหรับ Filter
  selectedYear: string = '2569'; // ค่าเริ่มต้น
  selectedDistrict: string = 'all';

  // ข้อมูลตัวเลือก (ควรดึงจาก API แต่ hardcode ทดสอบก่อนได้)
  years = ['2567', '2568', '2569'];
  districts = ['เมืองนครราชสีมา', 'ครบุรี', 'เสิงสาง']; // ⚠️ ใส่ชื่ออำเภอให้ครบ หรือดึงจาก API

  // ข้อมูลสำหรับแสดงผล
  groupedData: any = {}; // เก็บข้อมูลที่จัดกลุ่มแล้ว
  objectKeys = Object.keys; // ตัวช่วยสำหรับวนลูปใน HTML

  // 2. เช็ค Constructor ต้องมี private cd: ChangeDetectorRef
  constructor(private api: ApiService, private router: Router, private cd: ChangeDetectorRef) {}

  // เช็คว่าเป็น Admin เข้ามาดูไหม
  isAdminView = false;

  ngOnInit() {
    const userStored = localStorage.getItem('currentUser');
    if (userStored) {
      this.currentUser = JSON.parse(userStored);
      this.isAdminView = this.currentUser.isAdminView || false; // เช็ค Flag ว่าเป็น Admin View หรือไม่ (ต้องตั้งค่าใน Backend ด้วย)

      // 1. ตรวจสอบว่าดึง User ID มาถูกไหม
      console.log('Current User ID:', this.currentUser.id);

      // --- แก้ไข Logic การเลือกปี ---
      if (this.isAdminView) {
        // ถ้า Admin เข้ามาดู ให้ดึงปีที่ Admin เลือกไว้
        const savedYear = localStorage.getItem('adminSelectedYear');
        if (savedYear) {
          this.fiscalYear = parseInt(savedYear, 10);
        }
      } else {
        // ถ้า User เข้าเอง ให้เป็นปีเริ่มต้น (หรือปีปัจจุบัน)
        this.fiscalYear = 2569; 
      }
      // --------------------------
      console.log('Loading Data for Year:', this.fiscalYear);

      this.loadKpiData();
      this.loadData();
    } else {
      this.router.navigate(['/login']);
    }
  }
  
  backToAdmin() {
    // คืนร่าง Admin
    const adminSession = localStorage.getItem('adminSession');
    if (adminSession) {
      localStorage.setItem('currentUser', adminSession);
      localStorage.removeItem('adminSession');
      localStorage.removeItem('adminSelectedYear'); // ล้างค่าปีทิ้ง
      this.router.navigate(['/admin-dashboard']);
    }
  }

  loadData() {
    this.api.getDashboardSummary(this.selectedYear, this.selectedDistrict).subscribe({
      next: (res) => {
        if (res.success) {
          // แปลงข้อมูลดิบ ให้เป็นกลุ่มตาม "ชื่อประเด็น"
          this.groupedData = this.groupDataByIssue(res.data);
        }
      },
      error: (err) => console.error('Load Dashboard Failed', err)
    });
  }

  // 🛠️ ฟังก์ชันจัดกลุ่มข้อมูล (Helper)
  groupDataByIssue(data: any[]) {
    return data.reduce((acc: any, cur: any) => {
      const issue = cur.issue_name || 'ไม่ระบุประเด็น';
      if (!acc[issue]) {
        acc[issue] = [];
      }
      acc[issue].push(cur);
      return acc;
    }, {});
  }

  // 🛠️ ฟังก์ชันคำนวณ % ความสำเร็จ
  calcProgress(target: number, result: number): number {
    if (!target || target == 0) return 0;
    let percent = (result / target) * 100;
    return percent > 100 ? 100 : percent; // ไม่ให้เกิน 100% (แล้วแต่ requirement)
  }

  loadKpiData() {
    this.isLoading = true;
    this.dataMap = {};
    this.originalDataMap = {};
    this.changedCells = {};
    this.pendingChanges = [];

    // แสดง SweetAlert Loading
    Swal.fire({
      title: 'กำลังประมวลผล...',
      html: 'ระบบกำลังดึงข้อมูลและแสดงผล',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const safetyTimeout = setTimeout(() => {
      if (this.isLoading) {
        this.isLoading = false;
        Swal.fire({
          icon: 'warning',
          title: 'ใช้เวลานานผิดปกติ',
          text: 'ระบบไม่ได้รับข้อมูลตอบกลับ กรุณาลองใหม่อีกครั้ง',
          confirmButtonText: 'โหลดใหม่',
          confirmButtonColor: '#d33'
        }).then((res) => {
          if (res.isConfirmed) this.loadKpiData();
        });
      }
    }, 30000);

    this.api.getKpiStructure().subscribe({
      next: (res: any) => {
        if (res.success) {
          this.kpiStructure = res.data;

          if (!this.currentUser || !this.currentUser.id) {
             console.error("User ID is missing!");
             this.isLoading = false;
             clearTimeout(safetyTimeout);
             Swal.close();
             return;
          }

          this.api.getKpiData(this.currentUser.id, this.fiscalYear).subscribe({
            next: (dataRes: any) => {
              clearTimeout(safetyTimeout);
              if (dataRes.success && dataRes.data.length > 0) {
                dataRes.data.forEach((d: any) => {
                  const key = `${d.kpi_id}_${d.report_month}`;
                  this.dataMap[key] = d.kpi_value;
                  this.originalDataMap[key] = d.kpi_value;
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
              }, 500);
            },
            error: (err: any) => {
              clearTimeout(safetyTimeout);
              console.error('Data Load Error:', err);
              this.isLoading = false;
              this.cd.detectChanges();
              Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถโหลดข้อมูลได้' });
            }
          });
        }
      },
      error: (err: any) => {
        clearTimeout(safetyTimeout);
        console.error('Structure Load Error:', err);
        this.isLoading = false;
        this.cd.detectChanges();
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้' });
      }
    });
  }

  // เปิด/ปิดโหมดแก้ไข
  toggleEdit() {
    if (this.isEditing) {
      // ยกเลิกแก้ไข → คืนค่าเดิมทั้งหมด
      this.dataMap = { ...this.originalDataMap };
      this.changedCells = {};
      this.pendingChanges = [];
      this.isEditing = false;
      this.cd.detectChanges();
      const Toast = Swal.mixin({
        toast: true, position: 'top-end',
        showConfirmButton: false, timer: 1500, timerProgressBar: true
      });
      Toast.fire({ icon: 'info', title: 'ยกเลิกการแก้ไขแล้ว' });
    } else {
      this.isEditing = true;
      const Toast = Swal.mixin({
        toast: true, position: 'top-end',
        showConfirmButton: false, timer: 2000, timerProgressBar: true
      });
      Toast.fire({ icon: 'info', title: 'เปิดโหมดแก้ไขแล้ว' });
    }
  }

  onYearChange() { this.loadKpiData(); }

  getMonthName(m: number): string {
    const names = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return names[m];
  }

  getSum(kpiId: number): number {
    let sum = 0;
    this.months.forEach(m => {
      const val = this.dataMap[`${kpiId}_${m}`];
      if (val !== undefined && val !== null && val !== '') sum += parseFloat(val);
    });
    return sum;
  }

  onValueChange(kpiId: number, month: number, event: any) {
    let val = event.target.value;
    if (val === '') val = null;
    else {
      val = parseFloat(val);
      // ป้องกันค่าติดลบ
      if (val < 0) {
        val = 0;
        event.target.value = 0;
        Swal.fire({
          icon: 'warning', title: 'ไม่อนุญาตค่าติดลบ',
          text: 'กรุณากรอกค่า 0 ขึ้นไป', timer: 2000, showConfirmButton: false
        });
      }
    }

    const key = `${kpiId}_${month}`;
    this.dataMap[key] = val;

    // ไฮไลท์ช่องที่เปลี่ยนแปลง
    const originalVal = this.originalDataMap[key] !== undefined ? parseFloat(this.originalDataMap[key]) : null;
    const newVal = val !== null ? parseFloat(val) : null;

    if (originalVal === newVal || (originalVal === null && newVal === null)) {
      delete this.changedCells[key]; // ค่าเหมือนเดิม ลบไฮไลท์
    } else if (newVal !== null && (originalVal === null || newVal > originalVal)) {
      this.changedCells[key] = 'up';
    } else if (newVal !== null && originalVal !== null && newVal < originalVal) {
      this.changedCells[key] = 'down';
    } else {
      this.changedCells[key] = 'same';
    }

    const existingIndex = this.pendingChanges.findIndex(c => c.kpi_id === kpiId && c.month === month);
    if (existingIndex > -1) this.pendingChanges.splice(existingIndex, 1);

    // บันทึกเฉพาะรายการที่เปลี่ยนจริง
    if (originalVal !== newVal) {
      this.pendingChanges.push({ kpi_id: kpiId, month: month, value: val, oldValue: originalVal });
    }
  }

  // ดึงสถานะการเปลี่ยนแปลงของช่อง
  getCellChangeClass(kpiId: number, month: number): string {
    const key = `${kpiId}_${month}`;
    if (this.changedCells[key] === 'up') return 'bg-green-100 ring-1 ring-green-400';
    if (this.changedCells[key] === 'down') return 'bg-red-100 ring-1 ring-red-400';
    return '';
  }

// 1. ฟังก์ชันคำนวณร้อยละ (Result / Target * 100)
  getPercentage(kpiId: number): number {
    const target = this.dataMap[`${kpiId}_0`]; // เป้าหมาย (เดือน 0)
    const result = this.getSum(kpiId);         // ผลงาน (รวมยอด)

    if (!target || parseFloat(target) === 0) return 0;
    return (result / parseFloat(target)) * 100;
  }

  // หาชื่อ KPI จาก id
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

  save() {
    if (this.pendingChanges.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่มีการเปลี่ยนแปลง',
        text: 'คุณยังไม่ได้แก้ไขข้อมูลใดๆ',
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#3085d6'
      });
      return;
    }

    // ตรวจสอบรายการที่ลดลง
    const decreasedItems = this.pendingChanges.filter(c => {
      const oldVal = c.oldValue !== null && c.oldValue !== undefined ? parseFloat(c.oldValue) : 0;
      const newVal = c.value !== null && c.value !== undefined ? parseFloat(c.value) : 0;
      return newVal < oldVal;
    });

    // สร้าง HTML ตารางสรุป
    let tableHtml = `
      <div style="text-align: left; max-height: 350px; overflow-y: auto; font-size: 13px;">`;

    if (decreasedItems.length > 0) {
      tableHtml += `
        <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
          <div style="color: #dc2626; font-weight: bold; margin-bottom: 6px;">
            <i class="fas fa-exclamation-triangle"></i> แจ้งเตือน: มี ${decreasedItems.length} รายการที่คะแนนลดลง
          </div>
          ${decreasedItems.map(c => {
            const kpiName = this.findKpiName(c.kpi_id);
            const monthName = c.month === 0 ? 'เป้าหมาย' : this.getMonthName(c.month);
            const oldVal = c.oldValue !== null ? c.oldValue : 0;
            return `<div style="color: #991b1b; font-size: 12px; padding: 2px 0;">
              &bull; ${kpiName} (${monthName}): ${oldVal} → ${c.value} <span style="color:#dc2626;font-weight:bold;">▼ ลดลง ${(oldVal - c.value).toFixed(2)}</span>
            </div>`;
          }).join('')}
        </div>`;
    }

    tableHtml += `
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="background: #f3f4f6; border-bottom: 2px solid #ddd;">
             <th style="padding: 8px; text-align: left;">รายการ</th>
             <th style="padding: 8px; text-align: center;">เดือน</th>
             <th style="padding: 8px; text-align: right;">ค่าเดิม</th>
             <th style="padding: 8px; text-align: right;">ค่าใหม่</th>
             <th style="padding: 8px; text-align: center;">สถานะ</th>
          </tr>`;

    this.pendingChanges.forEach(c => {
      const kpiName = this.findKpiName(c.kpi_id);
      const monthName = c.month === 0 ? 'เป้าหมาย' : this.getMonthName(c.month);
      const oldVal = c.oldValue !== null && c.oldValue !== undefined ? parseFloat(c.oldValue) : 0;
      const newVal = c.value !== null ? parseFloat(c.value) : 0;

      let statusIcon = '';
      let rowBg = '';
      if (newVal > oldVal) {
        statusIcon = '<span style="color:#16a34a;font-weight:bold;">▲ เพิ่ม</span>';
        rowBg = 'background: #f0fdf4;';
      } else if (newVal < oldVal) {
        statusIcon = '<span style="color:#dc2626;font-weight:bold;">▼ ลด</span>';
        rowBg = 'background: #fef2f2;';
      } else {
        statusIcon = '<span style="color:#6b7280;">= เท่าเดิม</span>';
      }

      tableHtml += `
        <tr style="border-bottom: 1px solid #eee; ${rowBg}">
          <td style="padding: 8px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${kpiName}">${kpiName}</td>
          <td style="padding: 8px; text-align: center;">${monthName}</td>
          <td style="padding: 8px; text-align: right; color: #6b7280;">${c.oldValue !== null && c.oldValue !== undefined ? c.oldValue : '-'}</td>
          <td style="padding: 8px; text-align: right; font-weight: bold; color: #2563eb;">${c.value !== null ? c.value : '-'}</td>
          <td style="padding: 8px; text-align: center;">${statusIcon}</td>
        </tr>`;
    });

    tableHtml += `</table></div>`;

    Swal.fire({
      title: decreasedItems.length > 0 ? '⚠️ ยืนยันการบันทึกข้อมูล' : 'ยืนยันการบันทึกข้อมูล',
      html: tableHtml,
      icon: decreasedItems.length > 0 ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#d33',
      confirmButtonText: '<i class="fas fa-save"></i> ยืนยันบันทึก',
      cancelButtonText: 'ยกเลิก',
      width: '700px'
    }).then((result: any) => {
      if (result.isConfirmed) {
        this.confirmSave();
      }
    });
  }

  // 3. ฟังก์ชันยืนยันการบันทึก (Confirm Save)
  confirmSave() {
    // แสดง Loading
    Swal.fire({
      title: 'กำลังบันทึก...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    this.api.saveBatch({
      userId: this.currentUser.id,
      fiscalYear: this.fiscalYear,
      changes: this.pendingChanges
    }).subscribe({
      next: (res: any) => {
        if (res.success) {
          Swal.fire({
            icon: 'success',
            title: 'บันทึกสำเร็จ!',
            text: `บันทึกข้อมูลเรียบร้อย ${res.count} รายการ`,
            timer: 2000,
            showConfirmButton: false
          });
          this.pendingChanges = [];
          this.changedCells = {};
          this.isEditing = false; // ปิดโหมดแก้ไขหลังบันทึกสำเร็จ
          this.loadKpiData();
        }
      },
      error: (err: any) => {
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่',
        });
      }
    });
  }

  logout() {
    Swal.fire({
      title: 'ออกจากระบบ?',
      text: "คุณต้องการออกจากระบบใช่หรือไม่",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'ใช่, ออกจากระบบ'
    }).then((result: any) => {
      if (result.isConfirmed) {
        localStorage.removeItem('currentUser');
        this.router.navigate(['/login']);
      }
    });
  }

  // 5. ฟังก์ชันเปิดกราฟ (เรียกเมื่อกดปุ่มกราฟ)
  openChart(item: any) {
    this.currentChartTitle = item.label;

    // เตรียม Label (ชื่อเดือน)
    const labels = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
    
    // เตรียมข้อมูลผลงาน (Results) รายเดือน
    const results = this.months.map(m => {
      const val = this.dataMap[`${item.id}_${m}`];
      return val ? parseFloat(val) : 0;
    });

    // เตรียมข้อมูลเป้าหมาย (Target) - เส้นตรงเท่ากันทุกเดือน
    const targetVal = this.dataMap[`${item.id}_0`] ? parseFloat(this.dataMap[`${item.id}_0`]) : 0;
    // ถ้าเป้าหมายไม่ใช่ผลรวม (เช่น ร้อยละ) เส้นกราฟควรเป็นค่าคงที่
    // แต่ถ้าเป้าหมายเป็นผลรวม (Accumulate) อาจต้องหารเฉลี่ย (ในที่นี้ขอทำเป็นเส้น Benchmark คงที่ครับ)
    const targets = Array(12).fill(targetVal);

    // กำหนดค่าให้กราฟ
    this.chartData = {
      labels: labels,
      datasets: [
        {
          type: 'bar',
          label: 'ผลงาน (Result)',
          data: results,
          backgroundColor: 'rgba(34, 197, 94, 0.6)', // สีเขียวโปร่ง
          borderColor: 'rgba(34, 197, 94, 1)',
          borderWidth: 1,
          order: 2
        },
        {
          type: 'line',
          label: 'เป้าหมาย (Target)',
          data: targets,
          borderColor: 'rgba(234, 179, 8, 1)', // สีเหลือง
          borderWidth: 3,
          pointRadius: 0, // ไม่ต้องมีจุด
          fill: false,
          order: 1,
          tension: 0.1 // ความโค้งของเส้น (0.1 = เกือบตรง)
        }
      ]
    };

    this.showChartModal = true;
  }

  closeChart() {
    this.showChartModal = false;
  }

  goToOverview() {
    this.router.navigate(['/overview']);
  }
}

