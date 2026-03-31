import { Routes } from '@angular/router';
import { LoginComponent } from './login/login';
import { HomeComponent } from './home/home';
import { authGuard, loginGuard, adminGuard, superAdminGuard } from './guards/auth.guard';


export const routes: Routes = [
    { path: '', component: HomeComponent, pathMatch: 'full' },
    {
        path: 'features',
        loadComponent: () => import('./features/features').then(m => m.FeaturesComponent)
    },
    {
        path: 'user-guide',
        loadComponent: () => import('./user-guide/user-guide').then(m => m.UserGuideComponent)
    },
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
    {
        path: 'import-data',
        loadComponent: () => import('./import-data/import-data').then(m => m.ImportDataComponent),
        canActivate: [authGuard]   // user ทั่วไปนำเข้าได้เฉพาะ hospcode ตัวเอง
    },
    {
        path: 'export-data',
        loadComponent: () => import('./export-data/export-data').then(m => m.ExportDataComponent),
        canActivate: [adminGuard]
    },
    {
        path: 'agenda-report',
        loadComponent: () => import('./agenda-report/agenda-report').then(m => m.AgendaReportComponent)
        // สาธารณะ ไม่ต้อง login
    },
    {
        path: 'kpi-management',
        loadComponent: () => import('./kpi-management/kpi-management').then(m => m.KpiManagementComponent),
        canActivate: [superAdminGuard]  // เฉพาะ super_admin เท่านั้น
    },
    { path: 'user-management', redirectTo: 'kpi-management', pathMatch: 'full' },
    { path: '**', redirectTo: '' }  // URL ที่ไม่มี redirect ไป home
];