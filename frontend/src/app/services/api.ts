import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  // ตรวจสอบ Port ให้ตรงกับ docker-compose (3000)
  private apiUrl = environment.apiUrl; 

  constructor(private http: HttpClient) {}

  login(data: any) { return this.http.post(`${this.apiUrl}/login`, data); }
  getKpiStructure() { return this.http.get(`${this.apiUrl}/kpi-structure`); }
  getKpiData(userId: number, year: number) { return this.http.get(`${this.apiUrl}/kpi-data?userId=${userId}&fiscalYear=${year}`); }
  saveBatch(data: any) { return this.http.post(`${this.apiUrl}/kpi-data/batch`, data); }
  getAmphoes() { return this.http.get(`${this.apiUrl}/admin/amphoes`); }
  getAdminSummary(year: number, amphoe: string) { return this.http.get(`${this.apiUrl}/admin/summary?fiscalYear=${year}&amphoe=${amphoe}`); }
// เพิ่มฟังก์ชันสำหรับเรียก URL แบบกำหนดเอง
  get(endpoint: string) { return this.http.get(`${this.apiUrl}/${endpoint}`); }

  getDashboardSummary(year: string, districtId: string) {
    let params = new HttpParams();
    if (year) {
      params = params.set('fiscal_year', year);
    }
    if (districtId && districtId !== 'all') {
      params = params.set('district_id', districtId);
    }
      
    return this.http.get<any>(`${this.apiUrl}/dashboard/summary`, { params });
  }

  getDistricts() {
    return this.http.get<any>(`${this.apiUrl}/districts`);
  }

  getProvincialSummary(fiscalYear: number) {
    return this.http.get<any>(`${this.apiUrl}/provincial/summary?fiscalYear=${fiscalYear}`);
  }

  getHospitals() {
    return this.http.get<any>(`${this.apiUrl}/admin/hospitals`);
  }

  // --- Import Excel ---
  downloadTemplate(kpi_id: number, byear: number, hospcode?: string) {
    let url = `${this.apiUrl}/admin/import-template?kpi_id=${kpi_id}&byear=${byear}`;
    if (hospcode) url += `&hospcode=${hospcode}`;
    return this.http.get(url, { responseType: 'blob' });
  }

  importExcelPreview(file: File, filterHospcode?: string) {
    const formData = new FormData();
    formData.append('file', file);
    if (filterHospcode) formData.append('filterHospcode', filterHospcode);
    return this.http.post<any>(`${this.apiUrl}/admin/import-excel-preview`, formData);
  }

  importExcel(file: File, filterHospcode?: string) {
    const formData = new FormData();
    formData.append('file', file);
    if (filterHospcode) formData.append('filterHospcode', filterHospcode);
    return this.http.post<any>(`${this.apiUrl}/admin/import-excel`, formData);
  }

  // --- Export to staging tables ---
  getExportPreview() {
    return this.http.get<any>(`${this.apiUrl}/admin/export-preview`);
  }

  exportKorahealth(byear: number) {
    return this.http.post<any>(`${this.apiUrl}/admin/export-korathealth`, { byear });
  }

  getAgendaReport(fiscalYear: number) {
    return this.http.get<any>(`${this.apiUrl}/provincial/agenda-report?fiscalYear=${fiscalYear}`);
  }

  // ── KPI Management ──────────────────────────────────────────
  getKpiFullStructure()                { return this.http.get<any>(`${this.apiUrl}/admin/kpi-full-structure`); }
  createKpiIssue(d: any)               { return this.http.post<any>(`${this.apiUrl}/admin/kpi-issues`, d); }
  updateKpiIssue(id: number, d: any)   { return this.http.put<any>(`${this.apiUrl}/admin/kpi-issues/${id}`, d); }
  deleteKpiIssue(id: number)           { return this.http.delete<any>(`${this.apiUrl}/admin/kpi-issues/${id}`); }
  createKpiMain(d: any)                { return this.http.post<any>(`${this.apiUrl}/admin/kpi-main-indicators`, d); }
  updateKpiMain(id: number, d: any)    { return this.http.put<any>(`${this.apiUrl}/admin/kpi-main-indicators/${id}`, d); }
  deleteKpiMain(id: number)            { return this.http.delete<any>(`${this.apiUrl}/admin/kpi-main-indicators/${id}`); }
  createKpiSub(d: any)                 { return this.http.post<any>(`${this.apiUrl}/admin/kpi-sub-activities`, d); }
  updateKpiSub(id: number, d: any)     { return this.http.put<any>(`${this.apiUrl}/admin/kpi-sub-activities/${id}`, d); }
  deleteKpiSub(id: number)             { return this.http.delete<any>(`${this.apiUrl}/admin/kpi-sub-activities/${id}`); }
  createKpiItem(d: any)                { return this.http.post<any>(`${this.apiUrl}/admin/kpi-items`, d); }
  updateKpiItem(id: number, d: any)    { return this.http.put<any>(`${this.apiUrl}/admin/kpi-items/${id}`, d); }
  deleteKpiItem(id: number)            { return this.http.delete<any>(`${this.apiUrl}/admin/kpi-items/${id}`); }

  // ── Users Management ────────────────────────────────────────
  getAllUsers()                         { return this.http.get<any>(`${this.apiUrl}/admin/users-all`); }
  createUser(d: any)                   { return this.http.post<any>(`${this.apiUrl}/admin/users`, d); }
  updateUser(id: number, d: any)       { return this.http.put<any>(`${this.apiUrl}/admin/users/${id}`, d); }
  deleteUser(id: number)               { return this.http.delete<any>(`${this.apiUrl}/admin/users/${id}`); }

}