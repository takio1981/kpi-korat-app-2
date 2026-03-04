import { Routes } from '@angular/router';
import { LoginComponent } from './login/login';

export const routes: Routes = [
    { path: '', redirectTo: 'login', pathMatch: 'full' }, // เข้ามาหน้าแรกให้ไป Login
    { 
        path: 'login', 
        component: LoginComponent
    },
    { 
        path: 'overview', 
        loadComponent: () => import('./district-dashboard/district-dashboard').then(m => m.DistrictDashboardComponent) 
    },
    { 
        path: 'dashboard', 
        loadComponent: () => import('./dashboard/dashboard').then(m => m.DashboardComponent) 
    },
    { 
        path: 'admin-dashboard', 
        loadComponent: () => import('./admin-dashboard/admin-dashboard').then(m => m.AdminDashboardComponent) 
    },
    { 
        path: 'dashboard-summary', 
        loadComponent: () => import('./dashboard-summary/dashboard-summary').then(m => m.DashboardSummaryComponent) 
    }
];