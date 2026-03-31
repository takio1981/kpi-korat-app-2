import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api';
import { NavbarComponent } from '../shared/navbar/navbar';
import Swal from 'sweetalert2';

interface KpiItem   { id: number; sub_activity_id: number; name: string; unit: string; target_value: string | null; }
interface KpiSub    { id: number; main_ind_id: number; name: string; items: KpiItem[]; _open?: boolean; }
interface KpiMain   { id: number; issue_id: number; name: string; target_label: string; dep_id: number | null; dep_name: string | null; sub_activities: KpiSub[]; _open?: boolean; }
interface KpiIssue  { id: number; issue_no: number; name: string; main_indicators: KpiMain[]; _open?: boolean; }
interface User      { id: number; username: string; hospital_name: string; amphoe_name: string; role: string; hospcode: string; created_at: string; status: number; dep_id: number | null; dep_name: string | null; }

@Component({
  selector: 'app-kpi-management',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './kpi-management.html'
})
export class KpiManagementComponent implements OnInit {
  tab: 'kpi' | 'users' | 'audit' = 'kpi';
  isLoading = false;

  // KPI
  kpiStructure: KpiIssue[] = [];

  // Users
  users: User[] = [];
  departments: any[] = [];
  userSearch = '';
  userFilterAmphoe = '';
  userFilterStatus = '';   // '' | '1' | '0'
  userFilterRole   = '';   // '' | 'admin' | 'user' | etc.

  // Modal
  modal = { show: false, type: '' as 'issue'|'main'|'sub'|'item'|'user', mode: 'add' as 'add'|'edit' };
  form: any = {};

  // Audit Logs
  auditLogs: any[] = [];
  auditTotal = 0;
  auditPage = 1;
  auditLimit = 50;
  auditLoading = false;

  constructor(private api: ApiService, private cd: ChangeDetectorRef) {}

  ngOnInit() { this.loadKpi(); this.loadUsers(); this.loadDepartments(); }

  // ─── Audit Logs ──────────────────────────────────────────────
  loadAuditLogs() {
    this.auditLoading = true;
    this.api.getAuditLogs(this.auditPage, this.auditLimit).subscribe({
      next: (r: any) => {
        this.auditLogs = r.data;
        this.auditTotal = r.total;
        this.auditLoading = false;
        this.cd.detectChanges();
      },
      error: () => { this.auditLoading = false; }
    });
  }

  get auditTotalPages() { return Math.ceil(this.auditTotal / this.auditLimit); }

  onAuditPageChange(page: number) {
    if (page >= 1 && page <= this.auditTotalPages) {
      this.auditPage = page;
      this.loadAuditLogs();
    }
  }

  switchTab(t: 'kpi' | 'users' | 'audit') {
    this.tab = t;
    if (t === 'audit' && this.auditLogs.length === 0) this.loadAuditLogs();
  }

  // ─── KPI Load ───────────────────────────────────────────────
  loadKpi() {
    this.isLoading = true;
    this.api.getKpiFullStructure().subscribe({
      next: (r: any) => { this.kpiStructure = r.data; this.isLoading = false; this.cd.detectChanges(); },
      error: () => { this.isLoading = false; }
    });
  }

  // ─── Users Load ─────────────────────────────────────────────
  loadUsers() {
    this.api.getAllUsers().subscribe({ next: (r: any) => { this.users = r.data; this.cd.detectChanges(); } });
  }

  loadDepartments() {
    this.api.getDepartments().subscribe({ next: (r: any) => { if (r.success) this.departments = r.data; } });
  }

  get amphoeOptions(): string[] {
    return [...new Set(this.users.map(u => u.amphoe_name).filter(Boolean))].sort();
  }

  get filteredUsers() {
    const q = this.userSearch.toLowerCase();
    return this.users.filter(u => {
      if (q && !u.hospital_name.toLowerCase().includes(q) &&
                !u.amphoe_name.toLowerCase().includes(q) &&
                !u.username.toLowerCase().includes(q) &&
                !(u.hospcode || '').toLowerCase().includes(q)) return false;
      if (this.userFilterAmphoe && u.amphoe_name !== this.userFilterAmphoe) return false;
      if (this.userFilterRole   && u.role !== this.userFilterRole) return false;
      if (this.userFilterStatus !== '' && String(u.status) !== this.userFilterStatus) return false;
      return true;
    });
  }

  // ─── Modal helpers ──────────────────────────────────────────
  openAdd(type: 'issue'|'main'|'sub'|'item'|'user', parentId?: number, parentId2?: number) {
    this.modal = { show: true, type, mode: 'add' };
    this.form = { _parentId: parentId, _parentId2: parentId2 };
  }

  openEdit(type: 'issue'|'main'|'sub'|'item'|'user', obj: any) {
    this.modal = { show: true, type, mode: 'edit' };
    this.form = { ...obj };
    if (type === 'user') {
      this.form.dep_id = obj.dep_id || null;
    }
  }

  closeModal() { this.modal.show = false; this.form = {}; }

  // ─── Save (Add / Edit) ───────────────────────────────────────
  async save() {
    const { type, mode } = this.modal;
    const f = this.form;
    let obs: any;

    if (type === 'issue') {
      obs = mode === 'add'
        ? this.api.createKpiIssue({ issue_no: f.issue_no, name: f.name })
        : this.api.updateKpiIssue(f.id, { issue_no: f.issue_no, name: f.name });
    } else if (type === 'main') {
      obs = mode === 'add'
        ? this.api.createKpiMain({ issue_id: f._parentId, name: f.name, target_label: f.target_label, dep_id: f.dep_id || null })
        : this.api.updateKpiMain(f.id, { issue_id: f.issue_id, name: f.name, target_label: f.target_label, dep_id: f.dep_id || null });
    } else if (type === 'sub') {
      obs = mode === 'add'
        ? this.api.createKpiSub({ main_ind_id: f._parentId, name: f.name })
        : this.api.updateKpiSub(f.id, { main_ind_id: f.main_ind_id, name: f.name });
    } else if (type === 'item') {
      obs = mode === 'add'
        ? this.api.createKpiItem({ sub_activity_id: f._parentId, name: f.name, unit: f.unit, target_value: f.target_value, custom_id: f.custom_id || null })
        : this.api.updateKpiItem(f.id, { sub_activity_id: f.sub_activity_id, name: f.name, unit: f.unit, target_value: f.target_value });
    } else if (type === 'user') {
      obs = mode === 'add'
        ? this.api.createUser({ username: f.username, password: f.password, hospital_name: f.hospital_name, amphoe_name: f.amphoe_name, role: f.role || 'user', hospcode: f.hospcode, dep_id: f.dep_id || null })
        : this.api.updateUser(f.id, { username: f.username, hospital_name: f.hospital_name, amphoe_name: f.amphoe_name, role: f.role, hospcode: f.hospcode, dep_id: f.dep_id || null, password: f.newPassword || '' });
    }

    obs?.subscribe({
      next: () => {
        this.closeModal();
        if (type === 'user') this.loadUsers(); else this.loadKpi();
        Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1200, showConfirmButton: false });
      },
      error: (e: any) => Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: e?.error?.error || 'ไม่สามารถบันทึกได้' })
    });
  }

  // ─── Delete ─────────────────────────────────────────────────
  async deleteItem(type: 'issue'|'main'|'sub'|'item'|'user', id: number) {
    const result = await Swal.fire({
      icon: 'warning', title: 'ยืนยันการลบ', text: 'ข้อมูลที่เกี่ยวข้องอาจถูกลบด้วย',
      showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก'
    });
    if (!result.isConfirmed) return;

    const obs = type === 'issue' ? this.api.deleteKpiIssue(id)
      : type === 'main'  ? this.api.deleteKpiMain(id)
      : type === 'sub'   ? this.api.deleteKpiSub(id)
      : type === 'item'  ? this.api.deleteKpiItem(id)
      : this.api.deleteUser(id);

    obs.subscribe({
      next: () => {
        if (type === 'user') this.loadUsers(); else this.loadKpi();
        Swal.fire({ icon: 'success', title: 'ลบสำเร็จ', timer: 1000, showConfirmButton: false });
      },
      error: (e: any) => Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: e?.error?.error || 'ไม่สามารถลบได้' })
    });
  }

  toggle(obj: any) { obj._open = !obj._open; }

  // ─── Toggle user active status ──────────────────────────────
  toggleStatus(user: User) {
    const newStatus = +user.status === 1 ? 0 : 1;
    this.api.toggleUserStatus(user.id, !!newStatus).subscribe({
      next: () => {
        user.status = newStatus;
        this.cd.detectChanges();
      },
      error: (e: any) => Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: e?.error?.error || 'ไม่สามารถเปลี่ยนสถานะได้' })
    });
  }

  trackById(_: number, o: any) { return o.id; }
}
