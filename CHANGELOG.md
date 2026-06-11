# Changelog

## [Unreleased]

### 🎯 Features - Monitor Tab Enhancement

#### Multi-select KPI Items with Monthly Breakdown
- **Multi-select dropdown** for selecting KPI items (replaces single-select)
  - Users can select multiple KPI items at once
  - "Select All" / "Clear All" buttons for bulk operations
  - Item count badge on trigger button
  - Dynamic filtering based on selected issue

#### Enhanced Pivot Table with Monthly Columns
- **2-row table header**: KPI name (colspan) + sub-columns (target, monthly results)
- **Monthly comparison columns**: Shows target + performance by month for each KPI
- **Configurable month range**: Selector for 1, 2, 3, 4, 6 months lookback
- **Current month highlighting**: Visual indicator for the current fiscal month
- **Data validation**: Safe handling of monthly records across fiscal year boundaries

#### Performance % Calculation
- **Summary tab**: "ผ่านเป้าหมาย (%)" metric showing KPI items that achieved target (result ≥ target)
  - Formula: (KPI passed count / total KPI items) × 100
  - Color-coded thresholds: Red < 30%, Yellow 30-80%, Green ≥ 80%
  - Display format: Percentage + count (e.g., "87.5% (35/40)")

#### Excel Export Enhancement
- **Pivot export**: Includes monthly columns (target + each month breakdown)
- **Summary export**: Updated to show performance % instead of raw sum values

### 🐛 Bug Fixes

#### Calendar Month → Fiscal Month Conversion
- **Issue**: Database stores calendar month (1-12) but was mapped to fiscal month incorrectly
- **Root cause**: Missing conversion for monthly KPI records
- **Fix**: SQL CASE statement to convert calendar → fiscal month:
  - `cal >= 10` (Oct-Dec) → fiscal = cal - 9  (Oct=1, Nov=2, Dec=3)
  - `cal < 10` (Jan-Sep) → fiscal = cal + 3  (Jan=4, Feb=5, ..., Sep=12)
  - Applied in both diagnostic and main query
  - Target records (month=0) preserved as-is

#### Monthly Data Mapping
- **Issue**: Monthly results showed in wrong month columns
- **Fix**: Ensure CASE statement handles report_month=0 (target) separately before fiscal conversion

#### Data Freshness
- Server-side diagnostic queries log actual calendar/fiscal month mapping for debugging
- Frontend console logs show kpiMap structure for validation

### 🔧 Technical Changes

#### Backend (Node.js/Express)
- **api/server.js**: Modified `/admin/monitor-pivot` endpoint
  - Rewritten month list calculation with proper fiscal month logic
  - Separated target (month=0) from monthly results (month>0)
  - SQL CASE: `WHEN month=0 THEN 0 ELSE convert_to_fiscal(month)`
  - GROUP BY includes CASE expression for correct aggregation
  - Debug logging: `diagRows` shows calendar_month, fiscal_month, count

#### Frontend (Angular)
- **admin-dashboard.ts**:
  - Changed `selectedMonitorItems` from single value to `Set<number>` (multi-select)
  - Added `toggleMonitorItem()`, `toggleAllMonitorItems()` methods
  - Added `getPivotKpiMonth(row, kpiId, monthKey)` getter for monthly access
  - Added `pivotMonthHeaders`, `pivotMonthCount` for configurable month range
  - Updated `loadPivotData()` to pass `monthCount` to API
  - Debug logging in `loadPivotData()` for mapping validation

- **admin-dashboard.html**:
  - Multi-select dropdown UI with checkbox list (sticky header, clear button)
  - 2-row pivot table header: KPI group + sub-columns (target | month1 | month2 | ...)
  - Month range buttons: 1, 2, 3, 4, 6 months
  - Removed monthly-only sub-tab; integrated into pivot view
  - Updated summary stats display: "ผ่านเป้าหมาย (%)" with color coding

- **api.ts**: 
  - `getAdminMonitorPivot()` now accepts `monthCount` parameter
  - Updated URL to include `monthCount` query param

#### Docker & Deployment
- **Healthcheck improvements**: Adjusted API/Nginx healthcheck timing
- **Log rotation**: Configured 10MB × 3 for API, 5MB × 3 for Nginx
- **build.bat**: CRLF encoding fix for Windows CMD compatibility
- **deploy.sh**: Updated for new environment

### 📊 Data Validation
- All monthly records correctly mapped to fiscal month (1-12)
- Target records (month=0) separated from monthly results
- Key format: `fy * 100 + fiscal_month` (e.g., 256909 = FY2569 Sep)
- Frontend filters by `pivotMonthHeaders` key set

### 🧪 Testing Notes
- Test with data from different calendar months (especially Jun-Sep transition)
- Verify target values appear in pivot table
- Check month order (newest to oldest left-to-right)
- Validate multi-select dropdown with > 10 items
- Export Excel with monthly columns present

---

**Deployed**: 2026-06-11
**Components**: KPI Monitor รพ./สสอ. (Summary + Pivot with monthly breakdown)
**Database**: Assumes existing schema with kpi_records (calendar month 1-12)
