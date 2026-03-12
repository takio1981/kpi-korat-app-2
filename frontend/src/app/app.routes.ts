import { Routes } from '@angular/router';
import { LoginComponent } from './login/login';
import { HomeComponent } from './home/home';
import { authGuard, loginGuard, adminGuard } from './guards/auth.guard';


export const routes: Routes = [
    { path: '', component: HomeComponent, pathMatch: 'full' },
    {
        path: 'login',
        component: LoginComponent,
        canActivate: [loginGuard]  // ถ้า Login แล้ว redirect ไปหน้าหลักเลย
    },
    {
        path: 'overview',
        loadComponent: () => import('./district-dashboard/district-dashboard').then(m => m.DistrictDashboardComponent),
        canActivate: [authGuard]   // ต้อง Login ก่อน
    },
    {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard').then(m => m.DashboardComponent),
        canActivate: [authGuard]   // ต้อง Login ก่อน
    },
    {
        path: 'admin-dashboard',
        loadComponent: () => import('./admin-dashboard/admin-dashboard').then(m => m.AdminDashboardComponent),
        canActivate: [adminGuard]  // ต้อง Login และต้องเป็น Admin เท่านั้น
    },
    {
        path: 'dashboard-summary',
        loadComponent: () => import('./dashboard-summary/dashboard-summary').then(m => m.DashboardSummaryComponent),
        canActivate: [authGuard]   // ต้อง Login ก่อน
    },
    {
        path: 'provincial-kpi',
        loadComponent: () => import('./provincial-kpi/provincial-kpi').then(m => m.ProvincialKpiComponent)
        // ไม่มี authGuard — เปิดดูสาธารณะ แก้ไขได้เฉพาะ admin
    },
    { path: '**', redirectTo: '' }  // URL ที่ไม่มี redirect ไป home
];