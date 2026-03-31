import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { isAdminRole } from '../../guards/auth.guard';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.html'
})
export class NavbarComponent implements OnInit {
  userName = '';
  userRole = '';
  isAdmin = false;
  isSuperAdmin = false;
  mobileMenuOpen = false;

  // Change Password Modal
  showChangePwModal = false;
  pwForm = { current: '', newPw: '', confirm: '' };
  pwLoading = false;

  constructor(private router: Router, private api: ApiService) {}

  ngOnInit() {
    const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
    this.userName = user.hospital_name || user.username || '';
    this.userRole = user.role || '';
    this.isAdmin = isAdminRole(this.userRole);
    this.isSuperAdmin = this.userRole === 'super_admin';
  }

  toggleMobileMenu() {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  openChangePw() {
    this.pwForm = { current: '', newPw: '', confirm: '' };
    this.showChangePwModal = true;
  }

  submitChangePw() {
    if (!this.pwForm.current || !this.pwForm.newPw) {
      Swal.fire({ icon: 'warning', title: 'กรุณากรอกรหัสผ่านให้ครบ', timer: 1500, showConfirmButton: false });
      return;
    }
    if (this.pwForm.newPw !== this.pwForm.confirm) {
      Swal.fire({ icon: 'warning', title: 'รหัสผ่านใหม่ไม่ตรงกัน', timer: 1500, showConfirmButton: false });
      return;
    }
    if (this.pwForm.newPw.length < 6) {
      Swal.fire({ icon: 'warning', title: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร', timer: 1500, showConfirmButton: false });
      return;
    }
    this.pwLoading = true;
    this.api.changePassword(this.pwForm.current, this.pwForm.newPw).subscribe({
      next: () => {
        this.pwLoading = false;
        this.showChangePwModal = false;
        Swal.fire({ icon: 'success', title: 'เปลี่ยนรหัสผ่านสำเร็จ', timer: 1500, showConfirmButton: false });
      },
      error: (e: any) => {
        this.pwLoading = false;
        Swal.fire({ icon: 'error', title: 'ไม่สำเร็จ', text: e?.error?.error || 'เกิดข้อผิดพลาด' });
      }
    });
  }

  onLogout() {
    Swal.fire({
      title: 'ออกจากระบบ?',
      text: 'คุณต้องการออกจากระบบใช่หรือไม่',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#0d9488',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'ออกจากระบบ',
      cancelButtonText: 'ยกเลิก'
    }).then((result) => {
      if (result.isConfirmed) {
        localStorage.clear();
        sessionStorage.clear();
        this.router.navigate(['/']);
      }
    });
  }
}
