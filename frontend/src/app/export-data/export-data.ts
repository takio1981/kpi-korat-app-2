import { Component, OnInit, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './export-data.html'
})
export class ExportDataComponent implements OnInit {
  previewData: PreviewRow[] = [];
  existingTables: string[] = [];
  isLoadingPreview = false;
  previewError = '';
  exportResults: { byear: number; tables_updated: number; exported_rows: number }[] = [];
  isExporting = false;

  // Detail preview
  showDetailModal = false;
  detailByear: number | null = null;
  detailRows: any[] = [];
  isLoadingDetail = false;

  // Remote Sync
  showSyncSettings = false;
  isSyncing = false;
  syncConfig: any = {
    host: '', port: 3306, username: '', password_enc: '',
    database_name: '', enabled: false,
    schedule_type: 'interval',
    interval_value: 30,
    interval_unit: 'minute',
    daily_time: '12:00',
    start_date: null,
    end_date: null,
  };
  syncHistory: any[] = [];
  syncResult: any = null;

  // Compare result
  showCompareModal = false;
  isComparing = false;
  compareData: any = null;
  selectedKpiIds: Set<number> = new Set();

  constructor(private api: ApiService, private cd: ChangeDetectorRef, private zone: NgZone) {}

  ngOnInit() {
    this.loadPreview();
  }

  loadPreview() {
    this.isLoadingPreview = true;
    this.previewError = '';
    this.api.getExportPreview().subscribe({
      next: (res) => {
        this.zone.run(() => {
          this.isLoadingPreview = false;
          if (res.success) {
            this.previewData = res.data;
            this.existingTables = res.existing_tables || [];
          } else {
            this.previewError = res.message || 'ไม่สามารถโหลดข้อมูลได้';
          }
          this.cd.detectChanges();
        });
      },
      error: () => {
        this.zone.run(() => {
          this.isLoadingPreview = false;
          this.previewError = 'ไม่สามารถเชื่อมต่อ API ได้';
          this.cd.detectChanges();
        });
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
        this.zone.run(() => {
          this.isExporting = false;
          Swal.close();
          if (res.success) {
            this.exportResults = [res, ...this.exportResults.filter(r => r.byear !== row.byear)];
            this.cd.detectChanges();
          }
        });
        if (res.success) {
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
        this.zone.run(() => {
          this.isExporting = false;
          this.cd.detectChanges();
        });
        Swal.close();
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: 'ไม่สามารถเชื่อมต่อ API ได้' });
      }
    });
  }

  getExportResult(byear: number) {
    return this.exportResults.find(r => r.byear === byear);
  }

  openDetailModal(byear: number) {
    this.showDetailModal = true;
    this.detailByear = byear;
    this.detailRows = [];
    this.isLoadingDetail = true;
    this.api.getExportPreviewDetail(byear).subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          this.isLoadingDetail = false;
          if (res.success) {
            this.detailRows = res.data || [];
          }
          this.cd.detectChanges();
        });
      },
      error: () => {
        this.zone.run(() => {
          this.isLoadingDetail = false;
          this.cd.detectChanges();
        });
      }
    });
  }

  closeDetailModal() {
    this.showDetailModal = false;
    this.detailRows = [];
  }

  get readyCount(): number {
    return this.detailRows.filter((r) => r.ready).length;
  }
  get notReadyCount(): number {
    return this.detailRows.length - this.readyCount;
  }

  // ============= Remote Sync =============
  openSyncSettings() {
    this.showSyncSettings = true;
    this.loadSyncConfig();
    this.loadSyncHistory();
  }
  closeSyncSettings() { this.showSyncSettings = false; }

  loadSyncConfig() {
    this.api.getRemoteSyncConfig().subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          if (res.success && res.data) {
            this.syncConfig = { ...res.data };
            // password_enc มาเป็น "***" → เคลียร์ก่อนแสดง (ป้องกัน user งง)
            if (this.syncConfig.password_enc === '***') {
              this.syncConfig.password_enc = '';
            }
          }
          this.cd.detectChanges();
        });
      },
    });
  }

  loadSyncHistory() {
    this.api.getRemoteSyncHistory().subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          if (res.success) this.syncHistory = res.data;
          this.cd.detectChanges();
        });
      },
    });
  }

  testSyncConnection() {
    Swal.fire({ title: 'กำลังทดสอบ...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
    this.api.testRemoteSyncConnection(this.syncConfig).subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          Swal.fire({ icon: 'success', title: 'เชื่อมต่อสำเร็จ', text: res.message, timer: 2000 });
        });
      },
      error: (err: any) => {
        this.zone.run(() => {
          Swal.fire({ icon: 'error', title: 'เชื่อมต่อไม่สำเร็จ', text: err?.error?.error || 'ไม่ทราบสาเหตุ' });
        });
      },
    });
  }

  saveSyncConfig() {
    this.api.saveRemoteSyncConfig(this.syncConfig).subscribe({
      next: () => {
        this.zone.run(() => {
          Swal.fire({ icon: 'success', title: 'บันทึก config สำเร็จ', timer: 1500, showConfirmButton: false });
          this.loadSyncConfig();
        });
      },
      error: (err: any) => {
        Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: err?.error?.error });
      },
    });
  }

  async createLocalTables() {
    const r = await Swal.fire({
      title: 'สร้างตาราง 31 ตารางใน Local?',
      text: 'ระบบจะสร้างตารางที่ยังไม่มี (CREATE IF NOT EXISTS)',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'สร้าง',
      cancelButtonText: 'ยกเลิก',
    });
    if (!r.isConfirmed) return;
    Swal.fire({ title: 'กำลังสร้าง...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
    this.api.createExportTablesLocal().subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          Swal.fire({
            icon: 'success',
            title: 'สร้างตารางสำเร็จ',
            html: `สร้างแล้ว <b>${res.created}</b> ตาราง${res.errors?.length ? `<br><span class="text-red-600">⚠️ ${res.errors.length} ข้อผิดพลาด</span>` : ''}`,
          });
          this.loadPreview();
        });
      },
      error: (err: any) => {
        this.zone.run(() => {
          Swal.fire({ icon: 'error', title: 'สร้างไม่สำเร็จ', text: err?.error?.error });
        });
      },
    });
  }

  async createRemoteTables() {
    const r = await Swal.fire({
      title: 'สร้างตาราง 31 ตารางบน Server กลาง?',
      text: 'ต้องตั้ง config sync ก่อน — จะสร้างตารางที่ยังไม่มีบนปลายทาง',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'สร้าง',
      cancelButtonText: 'ยกเลิก',
    });
    if (!r.isConfirmed) return;
    Swal.fire({ title: 'กำลังสร้าง...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
    this.api.createExportTablesRemote().subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          Swal.fire({
            icon: 'success',
            title: 'สร้างตารางสำเร็จ',
            html: `สร้างแล้ว <b>${res.created}</b> ตาราง${res.errors?.length ? `<br><span class="text-red-600">⚠️ ${res.errors.length} ข้อผิดพลาด</span>` : ''}`,
          });
        });
      },
      error: (err: any) => {
        this.zone.run(() => {
          Swal.fire({ icon: 'error', title: 'สร้างไม่สำเร็จ', text: err?.error?.error });
        });
      },
    });
  }

  openCompareModal() {
    this.showCompareModal = true;
    this.isComparing = true;
    this.compareData = null;
    this.selectedKpiIds = new Set();
    this.api.compareRemoteSync().subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          this.isComparing = false;
          if (res.success) {
            this.compareData = res.data;
            // เลือกอัตโนมัติเฉพาะตารางที่มีข้อมูลใหม่
            this.compareData.tables.forEach((t: any) => {
              if (t.new_rows > 0 && t.local_exists && t.remote_exists) {
                this.selectedKpiIds.add(t.kpi_id);
              }
            });
          }
          this.cd.detectChanges();
        });
      },
      error: (err: any) => {
        this.zone.run(() => {
          this.isComparing = false;
          this.cd.detectChanges();
          Swal.fire({ icon: 'error', title: 'เปรียบเทียบไม่สำเร็จ', text: err?.error?.error || 'ไม่ทราบสาเหตุ' });
          this.showCompareModal = false;
        });
      },
    });
  }

  closeCompareModal() {
    this.showCompareModal = false;
    this.compareData = null;
    this.selectedKpiIds = new Set();
  }

  toggleKpiSelection(kpiId: number) {
    if (this.selectedKpiIds.has(kpiId)) this.selectedKpiIds.delete(kpiId);
    else this.selectedKpiIds.add(kpiId);
  }
  isKpiSelected(kpiId: number): boolean { return this.selectedKpiIds.has(kpiId); }
  selectAllKpis() {
    if (!this.compareData) return;
    this.compareData.tables.forEach((t: any) => {
      if (t.local_exists && t.remote_exists) this.selectedKpiIds.add(t.kpi_id);
    });
  }
  selectChangedOnly() {
    this.selectedKpiIds = new Set();
    if (!this.compareData) return;
    this.compareData.tables.forEach((t: any) => {
      if (t.new_rows > 0 && t.local_exists && t.remote_exists) this.selectedKpiIds.add(t.kpi_id);
    });
  }
  clearSelection() { this.selectedKpiIds = new Set(); }

  syncSelectedTables() {
    if (this.selectedKpiIds.size === 0) {
      Swal.fire({ icon: 'warning', title: 'ยังไม่ได้เลือกตาราง' });
      return;
    }
    const ids = Array.from(this.selectedKpiIds);
    this.closeCompareModal();
    this.runSyncWithKpiIds(ids);
  }

  async runSyncWithKpiIds(kpiIds: number[]) {
    const r = await Swal.fire({
      title: `Sync ${kpiIds.length} ตาราง?`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Sync', cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#0d9488',
    });
    if (!r.isConfirmed) return;
    this.isSyncing = true;
    Swal.fire({ title: 'กำลัง sync...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    this.api.runRemoteSync(undefined, kpiIds).subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          this.isSyncing = false;
          this.loadSyncHistory();
          this.cd.detectChanges();
          Swal.fire({
            icon: res.status === 'success' ? 'success' : (res.status === 'partial' ? 'warning' : 'error'),
            title: 'Sync เสร็จสิ้น',
            html: `<b>${res.tablesSynced}</b> ตาราง / <b>${res.rowsSynced.toLocaleString()}</b> แถว`,
          });
        });
      },
      error: (err: any) => {
        this.zone.run(() => {
          this.isSyncing = false;
          Swal.fire({ icon: 'error', title: 'Sync ไม่สำเร็จ', text: err?.error?.error });
        });
      },
    });
  }

  async runSync(byear?: number) {
    const result = await Swal.fire({
      title: byear ? `ส่งออกปีงบ ${byear} ไป Server กลาง?` : 'ส่งออกข้อมูลทั้งหมด ไป Server กลาง?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'ส่งออก', cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#0d9488',
    });
    if (!result.isConfirmed) return;

    this.isSyncing = true;
    Swal.fire({
      title: 'กำลังส่งข้อมูล...',
      html: 'กำลัง sync ไปยัง server ปลายทาง',
      allowOutsideClick: false, didOpen: () => Swal.showLoading(),
    });

    this.api.runRemoteSync(byear).subscribe({
      next: (res: any) => {
        this.zone.run(() => {
          this.isSyncing = false;
          this.syncResult = res;
          this.loadSyncHistory();
          this.cd.detectChanges();
          Swal.fire({
            icon: res.status === 'success' ? 'success' : (res.status === 'partial' ? 'warning' : 'error'),
            title: res.status === 'success' ? 'Sync สำเร็จ!' : (res.status === 'partial' ? 'Sync บางส่วน' : 'Sync ไม่สำเร็จ'),
            html: `
              <div class="text-left text-sm">
                <p>🗂️ ตาราง: <b>${res.tablesSynced}</b></p>
                <p>📋 แถว: <b>${res.rowsSynced.toLocaleString()}</b></p>
                ${res.errors?.length ? `<p class="text-red-600 mt-2">⚠️ ${res.errors.length} ข้อผิดพลาด</p>` : ''}
              </div>`,
          });
        });
      },
      error: (err: any) => {
        this.zone.run(() => {
          this.isSyncing = false;
          Swal.fire({ icon: 'error', title: 'Sync ไม่สำเร็จ', text: err?.error?.error || 'ไม่ทราบสาเหตุ' });
        });
      },
    });
  }
}
