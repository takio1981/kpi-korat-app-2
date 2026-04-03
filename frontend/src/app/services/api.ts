import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  // ตรวจสอบ Port ให้ตรงกับ docker-compose (3000)
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  login(data: any) {
    return this.http.post(`${this.apiUrl}/login`, data);
  }
  getKpiStructure() {
    return this.http.get(`${this.apiUrl}/kpi-structure`);
  }
  getKpiData(year: number, userId?: number) {
    const u = userId ? `&userId=${userId}` : '';
    return this.http.get(`${this.apiUrl}/kpi-data?fiscalYear=${year}${u}`);
  }
  saveBatch(data: any) {
    return this.http.post(`${this.apiUrl}/kpi-data/batch`, data);
  }
  getAmphoes() {
    return this.http.get(`${this.apiUrl}/admin/amphoes`);
  }
  getAdminSummary(year: number, amphoe: string) {
    return this.http.get(`${this.apiUrl}/admin/summary?fiscalYear=${year}&amphoe=${amphoe}`);
  }
  // เพิ่มฟังก์ชันสำหรับเรียก URL แบบกำหนดเอง
  get(endpoint: string) {
    return this.http.get(`${this.apiUrl}/${endpoint}`);
  }

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

  getProvincialSummaryByAmphoe(fiscalYear: number, amphoe: string) {
    return this.http.get<any>(
      `${this.apiUrl}/provincial/summary?fiscalYear=${fiscalYear}&amphoe=${encodeURIComponent(amphoe)}`,
    );
  }

  getHospitals(activeOnly = false) {
    const q = activeOnly ? '?activeOnly=1' : '';
    return this.http.get<any>(`${this.apiUrl}/admin/hospitals${q}`);
  }

  getDepartments() {
    return this.http.get<any>(`${this.apiUrl}/admin/departments`);
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
  getKpiFullStructure() {
    return this.http.get<any>(`${this.apiUrl}/admin/kpi-full-structure`);
  }
  createKpiIssue(d: any) {
    return this.http.post<any>(`${this.apiUrl}/admin/kpi-issues`, d);
  }
  updateKpiIssue(id: number, d: any) {
    return this.http.put<any>(`${this.apiUrl}/admin/kpi-issues/${id}`, d);
  }
  deleteKpiIssue(id: number) {
    return this.http.delete<any>(`${this.apiUrl}/admin/kpi-issues/${id}`);
  }
  createKpiMain(d: any) {
    return this.http.post<any>(`${this.apiUrl}/admin/kpi-main-indicators`, d);
  }
  updateKpiMain(id: number, d: any) {
    return this.http.put<any>(`${this.apiUrl}/admin/kpi-main-indicators/${id}`, d);
  }
  deleteKpiMain(id: number) {
    return this.http.delete<any>(`${this.apiUrl}/admin/kpi-main-indicators/${id}`);
  }
  createKpiSub(d: any) {
    return this.http.post<any>(`${this.apiUrl}/admin/kpi-sub-activities`, d);
  }
  updateKpiSub(id: number, d: any) {
    return this.http.put<any>(`${this.apiUrl}/admin/kpi-sub-activities/${id}`, d);
  }
  deleteKpiSub(id: number) {
    return this.http.delete<any>(`${this.apiUrl}/admin/kpi-sub-activities/${id}`);
  }
  createKpiItem(d: any) {
    return this.http.post<any>(`${this.apiUrl}/admin/kpi-items`, d);
  }
  updateKpiItem(id: number, d: any) {
    return this.http.put<any>(`${this.apiUrl}/admin/kpi-items/${id}`, d);
  }
  deleteKpiItem(id: number) {
    return this.http.delete<any>(`${this.apiUrl}/admin/kpi-items/${id}`);
  }

  // ── Users Management ────────────────────────────────────────
  getAllUsers() {
    return this.http.get<any>(`${this.apiUrl}/admin/users-all`);
  }
  createUser(d: any) {
    return this.http.post<any>(`${this.apiUrl}/admin/users`, d);
  }
  updateUser(id: number, d: any) {
    return this.http.put<any>(`${this.apiUrl}/admin/users/${id}`, d);
  }
  deleteUser(id: number) {
    return this.http.delete<any>(`${this.apiUrl}/admin/users/${id}`);
  }
  toggleUserStatus(id: number, status: boolean) {
    return this.http.patch<any>(`${this.apiUrl}/admin/users/${id}/status`, { status });
  }

  // ── Password Change ──────────────────────────────────────────
  changePassword(currentPassword: string, newPassword: string) {
    return this.http.post<any>(`${this.apiUrl}/me/change-password`, {
      currentPassword,
      newPassword,
    });
  }

  // ── Token Refresh ───────────────────────────────────────────
  refreshToken() {
    return this.http.post<any>(`${this.apiUrl}/refresh-token`, {});
  }

  // ── Audit Logs ───────────────────────────────────────────────
  getAuditLogs(page = 1, limit = 50) {
    return this.http.get<any>(`${this.apiUrl}/admin/audit-logs?page=${page}&limit=${limit}`);
  }

  // ── Main Indicator Records (ผลงานระดับตัวชี้วัดหลัก) ─────────
  getMainRecords(fiscalYear: number, amphoe?: string) {
    let url = `${this.apiUrl}/main-records?fiscalYear=${fiscalYear}`;
    if (amphoe) url += `&amphoe=${encodeURIComponent(amphoe)}`;
    return this.http.get<any>(url);
  }
  getMainRecordsSummary(fiscalYear: number) {
    return this.http.get<any>(`${this.apiUrl}/main-records/summary?fiscalYear=${fiscalYear}`);
  }
  saveMainRecordsBatch(data: any) {
    return this.http.post<any>(`${this.apiUrl}/main-records/batch`, data);
  }
  getMainRecordsByAmphoe(fiscalYear: number) {
    return this.http.get<any>(`${this.apiUrl}/main-records/by-amphoe?fiscalYear=${fiscalYear}`);
  }

  // ── Main Indicator Items (31 รายการของตัวชี้วัดหลัก) ─────────
  getMainRecordsItems(fiscalYear: number, amphoe?: string, mainIndId?: number) {
    let url = `${this.apiUrl}/main-records-items?fiscalYear=${fiscalYear}`;
    if (amphoe) url += `&amphoe_name=${encodeURIComponent(amphoe)}`;
    if (mainIndId) url += `&main_ind_id=${mainIndId}`;
    return this.http.get<any>(url);
  }

  getMainIndicatorItems(mainIndId: number) {
    return this.http.get<any>(`${this.apiUrl}/main-indicator-items?main_ind_id=${mainIndId}`);
  }

  getMainIndicatorConfig(mainIndId: number) {
    return this.http.get<any>(`${this.apiUrl}/main-indicator-config?main_ind_id=${mainIndId}`);
  }

  saveMainRecordsItemsBatch(data: any) {
    return this.http.post<any>(`${this.apiUrl}/main-records-items/batch`, data);
  }

  updateMainIndicatorConfig(data: any) {
    return this.http.post<any>(`${this.apiUrl}/main-indicator-config/update`, data);
  }

  updateMainRecordsItemsVisibility(data: any) {
    return this.http.post<any>(`${this.apiUrl}/main-records-items/visibility/batch`, data);
  }

  getMainIndicatorSummary(mainIndId: number, fiscalYear: number) {
    return this.http.get<any>(
      `${this.apiUrl}/main-indicator-summary?main_ind_id=${mainIndId}&fiscal_year=${fiscalYear}`,
    );
  }

  deleteMainIndicatorConfig(configId: number) {
    return this.http.delete<any>(`${this.apiUrl}/main-indicator-config/${configId}`);
  }

  // ── Export Admin Report → Excel (server-side, all rows) ──────
  downloadReportExcel(fiscalYear: number, amphoe: string, issueId: string, itemId: string) {
    let params = `fiscalYear=${fiscalYear}`;
    if (amphoe && amphoe !== 'ทั้งหมด') params += `&amphoe=${encodeURIComponent(amphoe)}`;
    if (issueId && issueId !== 'all') params += `&issueId=${issueId}`;
    if (itemId && itemId !== 'all') params += `&itemId=${itemId}`;
    return this.http.get(`${this.apiUrl}/admin/report-excel?${params}`, { responseType: 'blob' });
  }
}
