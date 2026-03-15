import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import Swal from 'sweetalert2';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  // แนบ JWT Token ถ้ามี (สำหรับทุก request ไปยัง API)
  const token = localStorage.getItem('authToken');
  let authReq: HttpRequest<unknown> = req;
  if (token) {
    authReq = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
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
