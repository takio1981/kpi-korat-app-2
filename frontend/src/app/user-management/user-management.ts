import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api';
import { NavbarComponent } from '../shared/navbar/navbar';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './user-management.html'
})
export class UserManagementComponent implements OnInit {
  users: any[] = [];
  filteredUsers: any[] = [];
  amphoeList: string[] = [];
  isLoading = false;

  // Filters
  searchText = '';
  filterAmphoe = 'all';
  filterRole = 'all';
  filterStatus = 'all';

  // Modal
  showModal = false;
  isEditMode = false;
  formData: any = { username: '', password: '', hospital_name: '', amphoe_name: '', role: 'user', hospcode: '' };
  editingId: number | null = null;
  isSaving = false;

  constructor(private api: ApiService) {}

  ngOnInit() { this.loadUsers(); }

  loadUsers() {
    this.isLoading = true;
    this.api.getAllUsers().subscribe({
      next: (res: any) => {
        if (res.success) {
          this.users = res.data;
          const set = new Set<string>(res.data.map((u: any) => u.amphoe_name).filter(Boolean));
          this.amphoeList = Array.from(set).sort();
          this.applyFilter();
        }
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; }
    });
  }

  applyFilter() {
    let temp = this.users;
    if (this.filterAmphoe !== 'all') {
      temp = temp.filter(u => u.amphoe_name === this.filterAmphoe);
    }
    if (this.filterRole !== 'all') {
      temp = temp.filter(u => u.role === this.filterRole);
    }
    if (this.filterStatus !== 'all') {
      const s = this.filterStatus === 'active' ? 1 : 0;
      temp = temp.filter(u => u.status === s);
    }
    if (this.searchText.trim()) {
      const q = this.searchText.toLowerCase();
      temp = temp.filter(u =>
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.hospital_name && u.hospital_name.toLowerCase().includes(q)) ||
        (u.hospcode && u.hospcode.toLowerCase().includes(q))
      );
    }
    this.filteredUsers = temp;
  }

  openCreateModal() {
    this.isEditMode = false;
    this.editingId = null;
    this.formData = { username: '', password: '', hospital_name: '', amphoe_name: '', role: 'user', hospcode: '' };
    this.showModal = true;
  }

  openEditModal(user: any) {
    this.isEditMode = true;
    this.editingId = user.id;
    this.formData = {
      username: user.username,
      password: '',
      hospital_name: user.hospital_name || '',
      amphoe_name: user.amphoe_name || '',
      role: user.role,
      hospcode: user.hospcode || ''
    };
    this.showModal = true;
  }

  closeModal() { this.showModal = false; }

  saveUser() {
    if (!this.formData.username.trim()) {
      Swal.fire({ icon: 'warning', title: 'กรุณากรอก Username' });
      return;
    }
    if (!this.isEditMode && !this.formData.password) {
      Swal.fire({ icon: 'warning', title: 'กรุณากรอกรหัสผ่าน' });
      return;
    }
    if (this.formData.password && this.formData.password.length < 6) {
      Swal.fire({ icon: 'warning', title: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
      return;
    }

    this.isSaving = true;
    const payload: any = { ...this.formData };
    if (!payload.password) delete payload.password;

    const obs = this.isEditMode
      ? this.api.updateUser(this.editingId!, payload)
      : this.api.createUser(payload);

    obs.subscribe({
      next: (res: any) => {
        this.isSaving = false;
        if (res.success) {
          Swal.fire({ icon: 'success', title: this.isEditMode ? 'แก้ไขสำเร็จ' : 'สร้างผู้ใช้สำเร็จ', timer: 1500, showConfirmButton: false });
          this.showModal = false;
          this.loadUsers();
        }
      },
      error: (err: any) => {
        this.isSaving = false;
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.error?.error || 'ไม่สามารถบันทึกข้อมูลได้' });
      }
    });
  }

  toggleStatus(user: any) {
    const newStatus = !user.status;
    Swal.fire({
      title: `${newStatus ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}ผู้ใช้?`,
      text: `${user.username} — ${user.hospital_name}`,
      icon: 'question', showCancelButton: true,
      confirmButtonColor: newStatus ? '#10b981' : '#ef4444',
      confirmButtonText: newStatus ? 'เปิดใช้งาน' : 'ปิดใช้งาน',
      cancelButtonText: 'ยกเลิก'
    }).then(r => {
      if (r.isConfirmed) {
        this.api.toggleUserStatus(user.id, newStatus).subscribe({
          next: () => {
            user.status = newStatus ? 1 : 0;
            Swal.fire({ icon: 'success', title: 'อัปเดตสำเร็จ', timer: 1000, showConfirmButton: false });
          },
          error: () => Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด' })
        });
      }
    });
  }

  deleteUser(user: any) {
    Swal.fire({
      title: 'ลบผู้ใช้?',
      html: `<b>${user.username}</b><br>${user.hospital_name || ''}`,
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: '<i class="fas fa-trash"></i> ยืนยันลบ',
      cancelButtonText: 'ยกเลิก'
    }).then(r => {
      if (r.isConfirmed) {
        this.api.deleteUser(user.id).subscribe({
          next: (res: any) => {
            if (res.success) {
              Swal.fire({ icon: 'success', title: 'ลบสำเร็จ', timer: 1500, showConfirmButton: false });
              this.loadUsers();
            }
          },
          error: () => Swal.fire({ icon: 'error', title: 'ไม่สามารถลบได้', text: 'ผู้ใช้อาจมีข้อมูล KPI ที่เชื่อมอยู่' })
        });
      }
    });
  }
}
