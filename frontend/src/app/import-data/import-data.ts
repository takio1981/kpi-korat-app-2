import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api';
import Swal from 'sweetalert2';
import { NavbarComponent } from '../shared/navbar/navbar';

interface KpiItem {
  id: number;
  name: string;
}

interface HospitalItem {
  hospcode: string;
  hospital_name: string;
  amphoe_name: string;
}

interface PreviewSummary {
  increased: number;
  decreased: number;
  unchanged: number;
  new_record: number;
  skipped: number;
}

@Component({
  selector: 'app-import-data',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './import-data.html'
})
export class ImportDataComponent implements OnInit {
  // KPI list
  kpiItems: KpiItem[] = [
    { id: 1,  name: 'จำนวน ศพด. ที่มีการหยอดยาน้ำเสริมธาตุเหล็ก' },
    { id: 2,  name: 'จำนวนเด็กใน ศพด. ที่ได้รับยาน้ำเสริมธาตุเหล็ก' },
    { id: 3,  name: 'จำนวน รร.อนุบาล ที่มีการหยอดยาน้ำเสริมธาตุเหล็ก' },
    { id: 4,  name: 'จำนวนเด็กใน รร.อนุบาล ที่ได้รับยาน้ำเสริมธาตุเหล็ก' },
    { id: 5,  name: 'จำนวนเด็กในชุมชนที่ได้รับยาน้ำเสริมธาตุเหล็กโดย อสม.' },
    { id: 6,  name: 'จำนวน ศพด. ที่จัดกิจกรรมส่งเสริม IQ (2222)' },
    { id: 7,  name: 'จำนวนเด็กใน ศพด. ที่เข้าร่วมกิจกรรม' },
    { id: 8,  name: 'จำนวน รร.อนุบาล ที่จัดกิจกรรมส่งเสริม IQ (2222)' },
    { id: 9,  name: 'จำนวนเด็กใน รร.อนุบาล ที่เข้าร่วมกิจกรรม' },
    { id: 10, name: 'จำนวน ศพด. ที่มีการชั่งน้ำหนัก/วัดส่วนสูง' },
    { id: 11, name: 'จำนวนเด็กใน ศพด. ที่ได้รับการชั่งน้ำหนัก' },
    { id: 12, name: 'จำนวนเด็กใน ศพด. ที่มีรูปร่างสมส่วน (ปกติ)' },
    { id: 13, name: 'จำนวน รร.อนุบาล ที่มีการชั่งน้ำหนัก/วัดส่วนสูง' },
    { id: 14, name: 'จำนวนเด็กใน รร.อนุบาล ที่ได้รับการชั่งน้ำหนัก' },
    { id: 15, name: 'จำนวนเด็กใน รร.อนุบาล ที่มีรูปร่างสมส่วน (ปกติ)' },
    { id: 16, name: 'จำนวนผู้ป่วยเบาหวานที่เข้าเรียนในโรงเรียนเบาหวาน' },
    { id: 17, name: 'จำนวนผู้ป่วยเบาหวานที่เข้าสู่ระยะสงบ (DM Remission)' },
    { id: 18, name: 'จำนวน ปชช.(15ปี+) ที่ได้รับความรู้/ปรับพฤติกรรม' },
    { id: 19, name: 'จำนวนผู้สัมผัสโรคพิษสุนัขบ้า' },
    { id: 20, name: 'จำนวนผู้สัมผัสโรคที่ได้รับวัคซีนครบชุด' },
    { id: 21, name: 'จำนวน อปท. ที่มีการฉีดวัคซีนสุนัข-แมว' },
    { id: 22, name: 'จำนวนสุนัขและแมวที่ได้รับการฉีดวัคซีน' },
    { id: 23, name: 'จำนวนโรงเรียนมัธยมที่เข้าร่วมโครงการ' },
    { id: 24, name: 'จำนวนครูที่ได้รับการอบรมทักษะการให้คำปรึกษา' },
    { id: 25, name: 'จำนวนนักเรียนที่ได้รับการคัดกรองสุขภาพจิต' },
    { id: 26, name: 'จำนวนแกนนำนักเรียน (YC) ที่ผ่านการอบรม' },
    { id: 27, name: 'จำนวน อปท. มีระบบบำบัดสิ่งปฏิกูล (อย่างน้อย1แห่ง/อ.)' },
    { id: 28, name: 'จำนวน อปท./หมู่บ้าน ที่ผ่านเกณฑ์ประปา 3C' },
    { id: 29, name: 'จำนวนร้านค้าชุมชน/ตลาด ที่ได้รับการตรวจ' },
    { id: 30, name: 'จำนวนตัวอย่างอาหารที่ตรวจสารปนเปื้อน (6 ชนิด)' },
    { id: 31, name: 'จำนวนร้านอาหารที่ผ่านเกณฑ์มาตรฐาน SAN' },
  ];

  selectedKpiId: number = 1;
  selectedYear: number = 2569;
  years: number[] = [2570, 2569, 2568, 2567];

  selectedFile: File | null = null;
  isDownloading = false;
  isPreviewing = false;
  isImporting = false;
  importResult: any = null;

  // Preview state
  previewSummary: PreviewSummary | null = null;
  previewSkipReasons: string[] = [];
  previewTotalRows = 0;
  previewError = '';

  isAdmin = false;
  userHospcode = '';

  // Admin: hospital selector
  hospitalList: HospitalItem[] = [];
  selectedHospcode = 'all';   // 'all' = ทั้งหมด (ไม่ pre-fill), หรือ hospcode เฉพาะ

  constructor(private api: ApiService) {}

  ngOnInit() {
    try {
      const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
      this.isAdmin = user.role === 'admin';
      this.userHospcode = user.hospcode || '';
    } catch {}

    if (this.isAdmin) {
      this.api.getHospitals().subscribe({
        next: (res) => { this.hospitalList = res.data || res; },
        error: () => {}
      });
    }
  }

  get selectedKpiName(): string {
    return this.kpiItems.find(k => k.id === this.selectedKpiId)?.name || '';
  }

  downloadTemplate() {
    this.isDownloading = true;
    let hospcode: string | undefined;
    if (this.isAdmin) {
      hospcode = this.selectedHospcode !== 'all' ? this.selectedHospcode : undefined;
    } else {
      hospcode = this.userHospcode;
    }
    this.api.downloadTemplate(this.selectedKpiId, this.selectedYear, hospcode).subscribe({
      next: (blob) => {
        this.isDownloading = false;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `template_kpi${this.selectedKpiId}_${this.selectedYear}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        this.isDownloading = false;
        Swal.fire({ icon: 'error', title: 'ดาวน์โหลดไม่สำเร็จ', text: 'ไม่สามารถเชื่อมต่อ API ได้' });
      }
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] || null;
    this.importResult = null;
    this.previewSummary = null;
    this.previewError = '';
  }

  loadPreview() {
    if (!this.selectedFile) return;
    const ext = this.selectedFile.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      Swal.fire({ icon: 'error', title: 'ไฟล์ไม่รองรับ', text: 'รองรับเฉพาะ .xlsx, .xls, .csv', confirmButtonColor: '#0d9488' });
      return;
    }

    this.isPreviewing = true;
    this.previewSummary = null;
    this.previewError = '';

    const filterHospcode = this.isAdmin ? undefined : this.userHospcode;
    this.api.importExcelPreview(this.selectedFile, filterHospcode).subscribe({
      next: (res) => {
        this.isPreviewing = false;
        if (res.success) {
          this.previewSummary = res.summary;
          this.previewSkipReasons = res.skip_reasons || [];
          this.previewTotalRows = res.total_data_rows || 0;
        } else {
          this.previewError = res.message || res.error || 'ไม่สามารถตรวจสอบข้อมูลได้';
        }
      },
      error: () => {
        this.isPreviewing = false;
        this.previewError = 'ไม่สามารถเชื่อมต่อ API ได้';
      }
    });
  }

  async confirmImport() {
    if (!this.selectedFile || !this.previewSummary) return;

    const { increased, decreased, new_record, unchanged } = this.previewSummary;
    const willChange = increased + decreased + new_record;

    if (willChange === 0) {
      Swal.fire({ icon: 'info', title: 'ไม่มีข้อมูลที่เปลี่ยนแปลง', text: 'ทุกแถวมีค่าเท่าเดิม ไม่มีอะไรต้องอัปเดต', confirmButtonColor: '#0d9488' });
      return;
    }

    const result = await Swal.fire({
      title: 'ยืนยันการนำเข้า?',
      html: `
        <div class="text-left text-sm space-y-1">
          <p>🆕 บันทึกใหม่: <strong>${new_record}</strong> รายการ</p>
          <p>📈 ค่าเพิ่มขึ้น: <strong>${increased}</strong> รายการ</p>
          <p>📉 ค่าลดลง: <strong>${decreased}</strong> รายการ</p>
          <p class="text-gray-400 text-xs">ไม่เปลี่ยนแปลง: ${unchanged} รายการ (จะถูกข้าม)</p>
        </div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'นำเข้าเลย',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#0d9488'
    });
    if (!result.isConfirmed) return;

    this.isImporting = true;
    Swal.fire({
      title: 'กำลังประมวลผล...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    const filterHospcode = this.isAdmin ? undefined : this.userHospcode;
    this.api.importExcel(this.selectedFile, filterHospcode).subscribe({
      next: (res) => {
        this.isImporting = false;
        Swal.close();
        if (res.success) {
          this.importResult = res;
          this.previewSummary = null;
          Swal.fire({
            icon: 'success',
            title: 'นำเข้าสำเร็จ!',
            html: `
              <div class="text-left text-sm space-y-1">
                <p>✅ บันทึกใหม่: <strong>${res.imported.toLocaleString()}</strong> รายการ</p>
                <p>🔄 อัปเดต: <strong>${res.updated.toLocaleString()}</strong> รายการ</p>
                ${res.unchanged_skip > 0 ? `<p class="text-gray-500">⏭️ ไม่เปลี่ยนแปลง: <strong>${res.unchanged_skip}</strong> แถว (ข้ามไป)</p>` : ''}
                ${res.skipped > 0 ? `<p class="text-orange-600">⚠️ ข้ามไป: <strong>${res.skipped}</strong> แถว (ไม่พบ hospcode หรือตัวชี้วัด)</p>` : ''}
                <p class="text-gray-400 text-xs mt-2">จากทั้งหมด ${res.total_rows} แถว</p>
              </div>`,
            confirmButtonColor: '#0d9488'
          });
        } else {
          Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: res.message || res.error });
        }
      },
      error: () => {
        this.isImporting = false;
        Swal.close();
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถเชื่อมต่อ API ได้' });
      }
    });
  }
}
