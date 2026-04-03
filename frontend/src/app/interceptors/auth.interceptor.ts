import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import Swal from 'sweetalert2';
import { ApiService } from '../services/api';

/** ตรวจสอบว่า JWT token จะหมดอายุภายใน N นาทีหรือไม่ */
function isTokenExpiringSoon(token: string, thresholdMinutes = 30): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expMs = payload.exp * 1000;
    return expMs - Date.now() < thresholdMinutes * 60 * 1000;
  } catch {
    return false;
  }
}

let isRefreshing = false;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const api = inject(ApiService);

  // แนบ JWT Token ถ้ามี (สำหรับทุก request ไปยัง API)
  const token = localStorage.getItem('authToken');
  let authReq: HttpRequest<unknown> = req;
  if (token) {
    authReq = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });

    // Auto-refresh token ถ้าเหลือน้อยกว่า 30 นาที (ไม่ refresh ซ้ำ + ไม่ refresh ตัว refresh-token เอง)
    if (!isRefreshing && !req.url.includes('/refresh-token') && !req.url.includes('/login') && isTokenExpiringSoon(token)) {
      isRefreshing = true;
      api.refreshToken().subscribe({
        next: (res: any) => {
          if (res?.token) {
            localStorage.setItem('authToken', res.token);
          }
          isRefreshing = false;
        },
        error: () => { isRefreshing = false; }
      });
    }
  }

  return next(authReq).pipe(
    catchError((error) => {

      // 401 — Session หมดอายุ / ไม่ได้ login
      if (error.status === 401) {
        localStorage.clear();
        sessionStorage.clear();
        Swal.close();
        Swal.fire({
          icon: 'error',
          title: 'Session หมดอายุ',
          text: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
          confirmButtonText: 'ตกลง',
          allowOutsideClick: false
        }).then(() => {
          router.navigate(['/login']);
        });
      }

      // 403 — ไม่มีสิทธิ์
      if (error.status === 403) {
        Swal.fire({
          icon: 'warning',
          title: 'ไม่มีสิทธิ์เข้าถึง',
          text: error?.error?.error || 'คุณไม่มีสิทธิ์ดำเนินการนี้',
          confirmButtonText: 'ตกลง'
        });
      }

      return throwError(() => error);
    })
  );
};
