import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

const ADMIN_ROLES = ['admin', 'admin_cup', 'admin_ssj', 'super_admin'];

export function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.includes(role);
}

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  try {
    const userStr = localStorage.getItem('currentUser');
    if (!userStr) {
      router.navigate(['/']);
      return false;
    }
    const user = JSON.parse(userStr);
    if (user?.id) {
      return true;
    }
    localStorage.removeItem('currentUser');
    router.navigate(['/']);
    return false;
  } catch {
    localStorage.removeItem('currentUser');
    router.navigate(['/']);
    return false;
  }
};

// Guard สำหรับหน้า login - ถ้า Login อยู่แล้วให้ redirect ไปหน้าที่เหมาะสม
export const loginGuard: CanActivateFn = () => {
  const router = inject(Router);
  const userStr = localStorage.getItem('currentUser');

  if (!userStr) {
    return true;
  }

  try {
    const user = JSON.parse(userStr);
    if (isAdminRole(user?.role)) {
      router.navigate(['/admin-dashboard']);
    } else {
      router.navigate(['/overview']);
    }
    return false;
  } catch {
    localStorage.removeItem('currentUser');
    return true;
  }
};

// Guard สำหรับตรวจสอบสิทธิ์ Admin ทุกระดับ
export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const userStr = localStorage.getItem('currentUser');

  if (!userStr) {
    router.navigate(['/']);
    return false;
  }

  try {
    const user = JSON.parse(userStr);
    if (isAdminRole(user?.role)) {
      return true;
    }
    router.navigate(['/']);
    return false;
  } catch {
    localStorage.removeItem('currentUser');
    router.navigate(['/']);
    return false;
  }
};

// Guard สำหรับ super_admin เท่านั้น (จัดการระบบ KPI)
export const superAdminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const userStr = localStorage.getItem('currentUser');

  if (!userStr) {
    router.navigate(['/']);
    return false;
  }

  try {
    const user = JSON.parse(userStr);
    if (user?.role === 'super_admin') {
      return true;
    }
    router.navigate(['/admin-dashboard']);
    return false;
  } catch {
    localStorage.removeItem('currentUser');
    router.navigate(['/']);
    return false;
  }
};
