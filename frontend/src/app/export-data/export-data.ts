import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../services/api';
import Swal from 'sweetalert2';
import { NavbarComponent } from '../shared/navbar/navbar';

interface PreviewRow {
  byear: number;
  kpis_with_data: number;
  total_hosps: number;
  total_records: number;
}

@Component({
  selector: 'app-export-data',
  standalone: true,
  imports: [CommonModule, NavbarComponent],
  templateUrl: './export-data.html'
})
export class ExportDataComponent implements OnInit {
  previewData: PreviewRow[] = [];
  existingTables: string[] = [];
  isLoadingPreview = false;
  previewError = '';
  exportResults: { byear: number; tables_updated: number; exported_rows: number }[] = [];
  isExporting = false;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadPreview();
  }

  loadPreview() {
    this.isLoadingPreview = true;
    this.previewError = '';
    this.api.getExportPreview().subscribe({
      next: (res) => {
        this.isLoadingPreview = false;
        if (res.success) {
          this.previewData = res.data;
          this.existingTables = res.existing_tables || [];
        } else {
          this.previewError = res.message || 'ไม่สามารถโหลดข้อมูลได้';
        }
      },
      error: () => {
        this.isLoadingPreview = false;
        this.previewError = 'ไม่สามารถเชื่อมต่อ API ได้';
      }
    });
  }

  async confirmExport(row: PreviewRow) {
    const missingTables = 31 - this.existingTables.length;
    const result = await Swal.fire({
      title: `ส่งออกข้อมูลปีงบ ${row.byear}?`,
      html: `
        <div class="text-left text-sm space-y-1">
          <p>📊 KPI ที่มีข้อมูล: <strong>${row.kpis_with_data}/31</strong></p>
          <p>🏥 หน่วยบริการ: <strong>${row.total_hosps.toLocaleString()}</strong></p>
          <p>📋 รายการทั้งหมด: <strong>${row.total_records.toLocaleString()}</strong></p>
          <p>🗂️ ตาราง Export ที่พบ: <strong>${this.existingTables.length}/31</strong></p>
          ${missingTables > 0
            ? `<p class="text-orange-600">⚠️ ไม่พบตาราง ${missingTables} ตาราง (จะถูกข้ามไป)</p>`
            : ''}
          <hr class="my-2">
          <p class="text-gray-500 text-xs">ข้อมูลเดิมในตาราง export สำหรับปีงบนี้จะถูก <strong>ลบและเขียนใหม่</strong></p>
        </div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'ส่งออกเลย',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#0d9488'
    });
    if (!result.isConfirmed) return;

    this.isExporting = true;
    Swal.fire({
      title: 'กำลังส่งออกข้อมูล...',
      html: `กำลังประมวลผลปีงบ ${row.byear} — อาจใช้เวลาสักครู่`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    this.api.exportKorahealth(row.byear).subscribe({
      next: (res) => {
        this.isExporting = false;
        Swal.close();
        if (res.success) {
          this.exportResults = [res, ...this.exportResults.filter(r => r.byear !== row.byear)];
          Swal.fire({
            icon: 'success',
            title: 'ส่งออกสำเร็จ!',
            html: `
              <div class="text-left text-sm space-y-1">
                <p>🗂️ ตารางที่อัปเดต: <strong>${res.tables_updated}</strong> ตาราง</p>
                <p>✅ แถวที่ส่งออก: <strong>${res.exported_rows.toLocaleString()}</strong> รายการ</p>
                ${res.errors?.length
                  ? `<p class="text-orange-600 mt-2">⚠️ ข้อผิดพลาด: ${res.errors.length} ตาราง</p>
                     <ul class="text-xs text-orange-600 list-disc list-inside">${res.errors.map((e: string) => `<li>${e}</li>`).join('')}</ul>`
                  : ''}
              </div>`,
            confirmButtonColor: '#0d9488'
          });
        } else {
          Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: res.message || res.error });
        }
      },
      error: () => {
        this.isExporting = false;
        Swal.close();
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถเชื่อมต่อ API ได้' });
      }
    });
  }

  getExportResult(byear: number) {
    return this.exportResults.find(r => r.byear === byear);
  }
}
