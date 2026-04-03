# Korat KPI App - Main Indicator Items Enhancement Implementation Guide

## Overview

This document describes the implementation of the Main Indicator Record enhancement that allows displaying all 31 KPI items within each main indicator, with the ability to hide/show items and configure which items feed into which agenda-report fields.

## What Has Been Implemented

### 1. Database Migration

**File**: `database/migration_v7_main_ind_items.sql`

New tables and columns:

- **kpi_main_records** (extended):
  - Added `item_id` (INT) - links to kpi_items (NULL = aggregate value)
  - Added `is_visible` (TINYINT) - 0 = hidden, 1 = visible

- **main_indicator_item_config** (new):
  - Links main_ind_id to item_id
  - Stores configuration: agenda_field, field_index, sort_order, display_name
  - Allows controlling which items show where in agenda-report

- **main_indicator_sub_activities** (new):
  - Maps sub_activities to main_indicators
  - Controls which sub-activities contribute to each main indicator

- **main_record_audit** (new):
  - Audit trail for changes to main indicator records

**To Apply Migration**:

```bash
mysql -u user -p database < database/migration_v7_main_ind_items.sql
```

### 2. API Endpoints

**File**: `api/server.js` (lines 1495-1747)

New REST endpoints for managing main indicator items:

#### Item-level Data

```
GET  /kpikorat/api/main-records-items
     ?fiscalYear=2569&amphoe_name=นครราชสีมา&main_ind_id=1

POST /kpikorat/api/main-records-items/batch
     Body: {fiscalYear, amphoe_name, main_ind_id, changes}

POST /kpikorat/api/main-records-items/visibility/batch
     Body: {main_ind_id, amphoe_name, fiscal_year, items}
```

#### Configuration Management

```
GET  /kpikorat/api/main-indicator-items?main_ind_id=1
GET  /kpikorat/api/main-indicator-config?main_ind_id=1
POST /kpikorat/api/main-indicator-config/update
     Body: {main_ind_id, item_id, agenda_field, sort_order, is_hidden}
DELETE /kpikorat/api/main-indicator-config/:configId
```

#### Summary

```
GET  /kpikorat/api/main-indicator-summary?main_ind_id=1&fiscal_year=2569
```

### 3. Frontend API Service

**File**: `frontend/src/app/services/api.ts` (added methods ~line 150)

New methods for consuming the new endpoints:

```typescript
// Item-level data methods
getMainRecordsItems(fiscalYear, amphoe?, mainIndId?)
saveMainRecordsItemsBatch(data)
updateMainRecordsItemsVisibility(data)

// Configuration methods
getMainIndicatorItems(mainIndId)
getMainIndicatorConfig(mainIndId)
updateMainIndicatorConfig(data)
deleteMainIndicatorConfig(configId)

// Summary
getMainIndicatorSummary(mainIndId, fiscalYear)
```

### 4. Frontend Component - Provincial KPI

**File**: `frontend/src/app/provincial-kpi/provincial-kpi.ts`

Enhanced main indicator modal with 31-item support:

#### New Properties

```typescript
mainIndicators: any[] // Now includes showItems, items, itemsLoading
```

#### New Methods

```typescript
loadMainIndItems(mainInd); // Load 31 items for a main indicator
loadMainIndItemValues(mainInd); // Load their recorded values
getMainIndItemValue(mainInd, item, month);
onMainIndItemValueChange(mainInd, item, month, event);
```

#### Modified Methods

```typescript
confirmSaveMainInd(); // Now saves both aggregate and item-level data
onMainIndAmphoeChange(); // Reset item views when amphoe changes
```

## How to Use

### Recording Main Indicator Items (Admin Only)

1. **Open Provincial KPI View**
   - Navigate to Provincial KPI page
   - Login as admin_ssj (สสจ) or admin_cup (อำเภอ)

2. **Click "ตัวชี้วัดหลัก" Button**
   - Opens main indicator modal
   - Shows all 12 main indicators

3. **Expand Items List**
   - Click the indicator name or expand icon
   - Shows all 31 items linked to that indicator
   - Edit values by month (Oct-Sep)

4. **Toggle Visibility**
   - Click eye icon to show/hide items (future feature)
   - Hidden items won't appear in agenda-report

5. **Save Data**
   - Click "บันทึก" (Save)
   - Confirm in dialog
   - System saves both aggregate values and item-level data

### Configuration (Future - Admin Setup)

To configure which items feed into which agenda-report fields:

```typescript
// Example: Configure items for main indicator 1 (Iron Supplementation)
api.updateMainIndicatorConfig({
  main_ind_id: 1,
  item_id: 2, // number of children receiving supplement
  agenda_field: "result",
  sort_order: 1,
  display_name: null, // use item name
});
```

## Frontend UI Implementation (To Be Done)

### HTML Template for Main Indicator Modal

Add to `provincial-kpi.html` near the main indicator data table:

```html
<!-- Expandable 31 Items List -->
<div class="mt-4 space-y-2" *ngFor="let mainInd of mainIndicators">
  <button
    (click)="loadMainIndItems(mainInd)"
    class="w-full px-4 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg
                 flex items-center justify-between"
  >
    <span class="font-semibold text-blue-900">{{ mainInd.name }}</span>
    <i
      class="fas"
      [class]="{
         'fa-chevron-down': mainInd.showItems,
         'fa-chevron-right': !mainInd.showItems
       }"
    ></i>
  </button>

  <!-- Items Grid (when expanded) -->
  <div *ngIf="mainInd.showItems" class="bg-gray-50 rounded-lg p-4 space-y-3">
    <div *ngIf="mainInd.itemsLoading" class="text-center py-4">
      <span class="text-gray-500"
        ><i class="fas fa-spinner fa-spin"></i> Loading...</span
      >
    </div>

    <div
      *ngFor="let item of mainInd.items"
      class="bg-white p-3 rounded-lg border border-gray-200"
    >
      <div class="flex justify-between items-start mb-2">
        <div>
          <p class="font-semibold text-gray-800">{{ item.name }}</p>
          <p class="text-xs text-gray-500">{{ item.sub_activity_name }}</p>
        </div>
        <span class="text-xs bg-gray-100 px-2 py-1 rounded"
          >{{ item.unit }}</span
        >
      </div>

      <!-- Month Input Row -->
      <div class="flex gap-1 text-xs overflow-x-auto">
        <input
          *ngFor="let m of months"
          [value]="getMainIndItemValue(mainInd, item, m) | number:'1.0-0'"
          (change)="onMainIndItemValueChange(mainInd, item, m, $event)"
          placeholder="0"
          [disabled]="!isMainIndEditing"
          class="w-12 px-1 py-1 border rounded text-center
                      disabled:bg-gray-100 disabled:cursor-not-allowed
                      focus:ring-2 focus:ring-teal-400"
        />
      </div>
    </div>
  </div>
</div>
```

## Agenda Report Integration (To Be Done)

Update `agenda-report.ts` to use item configurations:

```typescript
// When building agenda-report indicators, use configuration
const config = await api.getMainIndicatorConfig(mainIndId);

// For each indicator field, pull only items mapped to that field
const resultItems = config
  .filter((c) => c.agenda_field === "result")
  .map((c) => c.item_id);

// Calculate indicator value from result items instead of aggregate
const indicatorValue = recordedItems
  .filter((r) => resultItems.includes(r.item_id) && !r.is_visible === false)
  .reduce((sum, r) => sum + r.kpi_value, 0);
```

## Configuration Management UI (To Be Done)

Create new admin component for configuring item mappings:

```
Routes:
  /admin/main-indicator-config/:mainIndId

Component:
  src/app/admin/main-indicator-config/main-indicator-config.ts

Features:
  - List all 31 items for a main indicator
  - For each item, select:
    * Which agenda_field it contributes to (target, result, sub_result, etc.)
    * Sort order for display
    * Whether it can be hidden
  - Save configuration to main_indicator_item_config table
```

## Testing Checklist

- [ ] Run migration_v7 on test database
- [ ] Verify new columns in kpi_main_records
- [ ] Test API endpoints with Postman
- [ ] Verify item data saves correctly
- [ ] Test visibility toggle
- [ ] Verify configuration saves
- [ ] Test agenda-report uses new configuration
- [ ] Load test with large data volumes

## Future Enhancements

1. **Visibility Control**
   - Click eye icon to show/hide individual items
   - Persists to is_visible column
   - Hidden items don't show in agenda-report

2. **Drag-to-Reorder**
   - Reorder items using drag-and-drop
   - Updates sort_order in configuration

3. **Item Display Customization**
   - Rename items per main indicator (display_name)
   - Change units per main indicator
   - Hide/show columns (Month, Unit, Trend)

4. **Validation Rules**
   - Set min/max values per item
   - Cross-item validation (e.g., subtotals)
   - Auto-calculation formulas

5. **Export/Import**
   - Export 31-item data to Excel
   - Import from prepared templates

## Database Queries for Maintenance

### View main indicator items configuration

```sql
SELECT mic.*, ki.name, ks.name as sub_name
FROM main_indicator_item_config mic
LEFT JOIN kpi_items ki ON mic.item_id = ki.id
LEFT JOIN kpi_sub_activities ks ON ki.sub_activity_id = ks.id
WHERE mic.main_ind_id = 1
ORDER BY mic.sort_order, mic.item_id;
```

### View item-level records

```sql
SELECT mr.*, ki.name as item_name
FROM kpi_main_records mr
LEFT JOIN kpi_items ki ON mr.item_id = ki.id
WHERE mr.main_ind_id = 1 AND mr.fiscal_year = 2569
ORDER BY mr.item_id, mr.report_month;
```

### Audit changes

```sql
SELECT mra.*, ki.name, u.username
FROM main_record_audit mra
LEFT JOIN kpi_items ki ON mra.item_id = ki.id
LEFT JOIN users u ON mra.changed_by = u.id
WHERE mra.main_ind_id = 1
ORDER BY mra.changed_at DESC;
```

## Support & Troubleshooting

### Issue: Items not loading

- Check network tab in browser DevTools
- Verify API endpoint returns data
- Check main indicator has linked sub_activities

### Issue: Save fails

- Check browser console for errors
- Verify user has admin role
- Check database connectivity

### Issue: Visibility not persisting

- Ensure is_visible column exists in database
- Check API is saving to correct column

## References

- Database: MySQL 8.0+
- Frontend Framework: Angular 17+
- Backend: Node.js + Express
- ORM: mysql2/promise
