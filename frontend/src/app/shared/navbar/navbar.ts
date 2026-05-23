import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
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
  templateUrl: './navbar.html',
  styleUrls: ['./navbar.css'],
})
export class NavbarComponent implements OnInit {
  // User Info
  userName = '';
  userRole = '';
  username = '';
  hospitalName = '';
  amphoeName = '';
  depName = '';
  isAdmin = false;
  isSuperAdmin = false;

  mobileMenuOpen = false;
  profileMenuOpen = false;

  @ViewChild('profileContainer') profileContainer?: ElementRef<HTMLElement>;

  // Change Password Modal
  showChangePwModal = false;
  pwForm = { current: '', newPw: '', confirm: '' };
  pwLoading = false;

  constructor(
    private router: Router,
    private api: ApiService,
  ) {}

  ngOnInit() {
    const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
    this.username = user.username || '';
    this.hospitalName = user.hospital_name || '';
    this.amphoeName = user.amphoe_name || '';
    this.depName = user.dep_name || '';
    this.userName = this.hospitalName || this.username;
    this.userRole = user.role || '';
    this.isAdmin = isAdminRole(this.userRole);
    this.isSuperAdmin = this.userRole === 'super_admin';
  }

  toggleMobileMenu() {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  toggleProfileMenu() {
    this.profileMenuOpen = !this.profileMenuOpen;
  }

  closeProfileMenu() {
    this.profileMenuOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.profileMenuOpen) return;
    const target = event.target as HTMLElement | null;
    if (target && !this.profileContainer?.nativeElement.contains(target)) {
      this.profileMenuOpen = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.profileMenuOpen) this.profileMenuOpen = false;
  }

  // แปลงชื่อ role ให้สวย
  get roleLabel(): string {
    const map: { [k: string]: string } = {
      super_admin: 'Super Admin',
      admin: 'Admin',
      admin_ssj: 'Admin สสจ.',
      admin_cup: 'Admin CUP',
      user: 'User',
    };
    return map[this.userRole] || this.userRole;
  }

  get roleBadgeClass(): string {
    const map: { [k: string]: string } = {
      super_admin: 'bg-purple-100 text-purple-700',
      admin: 'bg-red-100 text-red-700',
      admin_ssj: 'bg-orange-100 text-orange-700',
      admin_cup: 'bg-amber-100 text-amber-700',
      user: 'bg-teal-100 text-teal-700',
    };
    return map[this.userRole] || 'bg-gray-100 text-gray-700';
  }

  openChangePw() {
    this.pwForm = { current: '', newPw: '', confirm: '' };
    this.showChangePwModal = true;
  }

  submitChangePw() {
    if (!this.pwForm.current || !this.pwForm.newPw) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกรหัสผ่านให้ครบ',
        timer: 1500,
        showConfirmButton: false,
      });
      return;
    }
    if (this.pwForm.newPw !== this.pwForm.confirm) {
      Swal.fire({
        icon: 'warning',
        title: 'รหัสผ่านใหม่ไม่ตรงกัน',
        timer: 1500,
        showConfirmButton: false,
      });
      return;
    }
    if (this.pwForm.newPw.length < 6) {
      Swal.fire({
        icon: 'warning',
        title: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร',
        timer: 1500,
        showConfirmButton: false,
      });
      return;
    }
    this.pwLoading = true;
    this.api.changePassword(this.pwForm.current, this.pwForm.newPw).subscribe({
      next: () => {
        this.pwLoading = false;
        this.showChangePwModal = false;
        Swal.fire({
          icon: 'success',
          title: 'เปลี่ยนรหัสผ่านสำเร็จ',
          timer: 1500,
          showConfirmButton: false,
        });
      },
      error: (e: any) => {
        this.pwLoading = false;
        Swal.fire({ icon: 'error', title: 'ไม่สำเร็จ', text: e?.error?.error || 'เกิดข้อผิดพลาด' });
      },
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
      cancelButtonText: 'ยกเลิก',
    }).then((result) => {
      if (result.isConfirmed) {
        localStorage.clear();
        sessionStorage.clear();
        this.router.navigate(['/']);
      }
    });
  }
}
