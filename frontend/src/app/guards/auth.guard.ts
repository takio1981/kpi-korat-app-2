import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const currentUser = localStorage.getItem('currentUser');

  if (currentUser) {
    return true;
  }

  router.navigate(['/login']);
  return false;
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
    if (user?.role === 'admin') {
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

// Guard สำหรับตรวจสอบสิทธิ์ Admin เท่านั้น
export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const userStr = localStorage.getItem('currentUser');

  if (!userStr) {
    router.navigate(['/login']);
    return false;
  }

  try {
    const user = JSON.parse(userStr);
    if (user?.role === 'admin') {
      return true;
    }
    router.navigate(['/overview']);
    return false;
  } catch {
    localStorage.removeItem('currentUser');
    router.navigate(['/login']);
    return false;
  }
};
