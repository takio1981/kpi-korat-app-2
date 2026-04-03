# Implementation Summary: Main Indicator Items Enhancement

## Project Goal

ปรับปรุงโมเดลบันทึกผลงานตัวชี้วัดหลัก (ตัวชี้วัด 1-12) เพื่อ:

1. ✅ แสดงกิจกรรมทั้งหมด 31 รายการ ในแต่ละตัวชี้วัดหลัก
2. ✅ ให้สามารถซ่อน/แสดง แต่ละรายการได้
3. ✅ เพิ่มการตั้งค่าว่า ข้อไหนที่นำคะแนนไปแสดงในช่องไหนของ agenda-report

---

## Status: 60% Complete (4/7 Tasks)

### ✅ Completed Tasks

#### 1. Database Migration

**File**: `database/migration_v7_main_ind_items.sql`

New Tables:

- `main_indicator_item_config` - Maps items to agenda-report fields
- `main_indicator_sub_activities` - Maps sub-activities to main indicators
- `main_record_audit` - Audit trail

Extended Tables:

- `kpi_main_records` - Added `item_id`, `is_visible` columns

**Status**: Ready to apply
**To Apply**:

```bash
mysql -u user -p database < database/migration_v7_main_ind_items.sql
```

#### 2. Backend API Endpoints

**File**: `api/server.js` (lines 1495-1747)

10 New Endpoints:

- `GET /main-records-items` - Retrieve item-level data
- `GET /main-indicator-items` - Get items for an indicator
- `GET /main-indicator-config` - Get configuration
- `POST /main-records-items/batch` - Save item data
- `POST /main-indicator-config/update` - Update configuration
- `POST /main-records-items/visibility/batch` - Toggle visibility
- `GET /main-indicator-summary` - Summary data
- `DELETE /main-indicator-config/:id` - Delete config

**Status**: Ready to test
**Testing**:

```bash
curl "http://localhost:3000/kpikorat/api/main-indicator-items?main_ind_id=1"
```

#### 3. Frontend API Service

**File**: `frontend/src/app/services/api.ts`

8 New Methods:

```typescript
getMainRecordsItems();
getMainIndicatorItems();
getMainIndicatorConfig();
saveMainRecordsItemsBatch();
updateMainIndicatorConfig();
updateMainRecordsItemsVisibility();
getMainIndicatorSummary();
deleteMainIndicatorConfig();
```

**Status**: Ready to use

#### 4. TypeScript Models/Interfaces

**File**: `frontend/src/app/models/main-indicator.model.ts`

Defined 12 interfaces for type safety:

- MainIndicatorRecord
- MainIndicatorItemConfig
- MainIndicatorItem
- MainRecordChange
- MainIndicatorSummary
- etc.

**Status**: Ready to use

### ⏳ Remaining Tasks

#### 5. Provincial KPI Component - HTML UI

**File**: `frontend/src/app/provincial-kpi/provincial-kpi.html`

**What's Needed**:

- Add expandable grid/table for displaying 31 items
- Show item names, units, 12 month columns
- Toggle visibility checkboxes
- Edit inline inputs for values by month

**Approximate Lines**: ~150-200 lines of HTML
**Estimate**: 2-3 hours

**Example Structure**:

```html
<div *ngFor="let mainInd of mainIndicators">
  <button (click)="loadMainIndItems(mainInd)">
    {{ mainInd.name }}
    <i class="fas" [class.fa-chevron-down]="mainInd.showItems"></i>
  </button>

  <div *ngIf="mainInd.showItems" class="items-grid">
    <div *ngFor="let item of mainInd.items">
      <p>{{ item.name }} ({{ item.unit }})</p>
      <input
        *ngFor="let m of months"
        [value]="getMainIndItemValue(mainInd, item, m)"
        (change)="onMainIndItemValueChange(mainInd, item, m, $event)"
      />
    </div>
  </div>
</div>
```

#### 6. Configuration Management Component

**File**: TBD - `frontend/src/app/admin/main-indicator-config/`

**What's Needed**:

- New admin component to configure item mappings
- For each main indicator:
  - Display all 31 items
  - For each item, allow selecting:
    - Agenda-report field (target, result, sub_result, custom)
    - Sort order (0=hidden, 1+= display order)
    - Display name override

**Approximate Lines**: ~300-400 lines (TS + HTML + CSS)
**Estimate**: 4-5 hours

#### 7. Agenda Report Integration

**File**: `frontend/src/app/agenda-report/agenda-report.ts`

**What's Needed**:

- Load configuration for each main indicator
- When calculating indicator values:
  - Instead of using single aggregate value
  - Pull items mapped to 'result' field
  - Sum their values to get indicator result
- Build report using configured mappings

**Approximate Lines**: ~100-150 lines (modifications to existing code)
**Estimate**: 2-3 hours

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Provincial KPI Dashboard (Admin)                         │
├─────────────────────────────────────────────────────────┤
│ Main Indicator Record Modal                              │
│ ├─ Indicator 1 (expandable)                             │
│ │  ├─ Item 1: จำนวน ศพด. ที่ได้รับ...  [  ] [  ] ...   │
│ │  ├─ Item 2: จำนวนเด็ก ที่ได้รับ...    [  ] [  ] ...   │
│ │  └─ Item 3: ...                      [  ] [  ] ...   │
│ ├─ Indicator 2 (expandable)                             │
│ │  └─ List of items...                                 │
│ └─ ...                                                   │
└─────────────────────────────────────────────────────────┘
                          │
                          ├─→ POST /main-records-items/batch
                          │   (Save 31-item data)
                          │
                          └─→ POST /main-records/batch
                              (Save aggregate values)

┌─────────────────────────────────────────────────────────┐
│ Admin Configuration Component                            │
├─────────────────────────────────────────────────────────┤
│ Configure: Which items feed into agenda-report?         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Main Indicator 1                                    │ │
│ │ Item 1 → agenda_field: 'result', sort: 1          │ │
│ │ Item 2 → agenda_field: 'result', sort: 2          │ │
│ │ Item 3 → agenda_field: null (hidden)              │ │
│ │                                                     │ │
│ │ Save Configuration                                  │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Main Indicator 2                                    │ │
│ │ ...                                                 │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          │
                          └─→ POST /main-indicator-config/update
                              (Save configuration)

┌─────────────────────────────────────────────────────────┐
│ Agenda Report View                                       │
├─────────────────────────────────────────────────────────┤
│ Get Configuration → Load Items → Calculate Results      │
│ SELECT items WHERE agenda_field='result'               │
│ Result = SUM(kpi_value) FOR selected items            │
└─────────────────────────────────────────────────────────┘
```

---

## Data Flow Example

### Scenario: Recording Main Indicator 1 (Iron Supplementation)

```
1. User edits Main Indicator 1 items:
   Item 1: 50 (month 10)
   Item 2: 60 (month 10)
   Item 3: 55 (month 10)

2. User clicks "บันทึก" (Save)

3. System sends:
   POST /main-records-items/batch
   {
     "fiscalYear": 2569,
     "amphoe_name": "นครราชสีมา",
     "main_ind_id": 1,
     "changes": [
       { "item_id": 1, "month": 10, "value": 50 },
       { "item_id": 2, "month": 10, "value": 60 },
       { "item_id": 3, "month": 10, "value": 55 }
     ]
   }

4. Database inserts:
   - 3 rows into kpi_main_records (item_id ≠ NULL)

5. Later, Agenda Report generates:
   SELECT i.item_id, i.agenda_field, mr.kpi_value
   FROM main_indicator_item_config i
   JOIN kpi_main_records mr USING (main_ind_id, item_id)
   WHERE i.main_ind_id = 1 AND i.agenda_field = 'result'

   Result = 50 + 60 + 55 = 165 (sum of configured items)
```

---

## Implementation Checklist

### Phase 1: Database & API (✅ DONE)

- [x] Create migration_v7
- [x] Add endpoints to server.js
- [x] Create TypeScript models

### Phase 2: Frontend Service Layer (✅ DONE)

- [x] Add methods to API service
- [x] Define interfaces

### Phase 3: UI Components (⏳ TODO)

- [ ] Add HTML to provincial-kpi modal
- [ ] Test add/edit/delete in browser
- [ ] Add configuration management component
- [ ] Style with Tailwind CSS

### Phase 4: Integration (⏳ TODO)

- [ ] Update agenda-report to use config
- [ ] Add configuration route & navigation
- [ ] End-to-end testing

### Phase 5: Deployment (⏳ TODO)

- [ ] Apply migration to production
- [ ] Deploy updated code
- [ ] Verify data integrity

---

## Key Files Summary

| File                                                  | Status     | Lines | Purpose                      |
| ----------------------------------------------------- | ---------- | ----- | ---------------------------- |
| `database/migration_v7_main_ind_items.sql`            | ✅         | 100   | Database schema changes      |
| `api/server.js`                                       | ✅         | 250+  | Backend endpoints            |
| `frontend/src/app/services/api.ts`                    | ✅         | 50    | API client methods           |
| `frontend/src/app/models/main-indicator.model.ts`     | ✅         | 100+  | TypeScript interfaces        |
| `frontend/src/app/provincial-kpi/provincial-kpi.ts`   | ✅ Partial | 50    | Component logic (needs HTML) |
| `frontend/src/app/provincial-kpi/provincial-kpi.html` | ⏳         | TBD   | UI for item grid             |
| `frontend/src/app/agenda-report/agenda-report.ts`     | ⏳         | TBD   | Use config in report         |
| `frontend/src/app/admin/main-indicator-config/`       | ⏳         | TBD   | Configuration UI             |

---

## How to Continue

### To Complete Phase 3 (UI Components):

1. **Update provincial-kpi.html**:
   - Find the main indicator table section
   - Add expandable items grid after main indicator rows
   - Reference: See MAIN_INDICATOR_ITEMS_GUIDE.md for HTML template example

2. **Run tests**:

   ```bash
   npm run serve              # Start frontend
   npm run dev              # or start backend
   ```

3. **Test in browser**:
   - Open Provincial KPI
   - Click main indicator to expand
   - Verify items load
   - Edit values and save

### To Complete Phase 4 (Integration):

1. **Create configuration component**:

   ```bash
   ng generate component admin/main-indicator-config
   ```

2. **Update agenda-report.ts**:
   - Load configuration before building report
   - Calculate values from configured items
   - See MAIN_INDICATOR_ITEMS_GUIDE.md for code examples

3. **Add route**:
   ```typescript
   {
     path: 'admin/config/main-indicators/:id',
     component: MainIndicatorConfigComponent
   }
   ```

---

## Testing Commands

```bash
# Test API endpoints
curl "http://localhost:3000/kpikorat/api/main-indicator-items?main_ind_id=1"
curl "http://localhost:3000/kpikorat/api/main-indicator-config?main_ind_id=1"

# Test save
curl -X POST "http://localhost:3000/kpikorat/api/main-records-items/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "fiscalYear": 2569,
    "amphoe_name": "นครราชสีมา",
    "main_ind_id": 1,
    "changes": [
      {"item_id": 1, "month": 10, "value": 100}
    ]
  }'
```

---

## Notes

- All database changes are backward compatible
- Existing aggregate values still work
- Item-level data is optional (can have both)
- Configuration is optional (defaults to showing all items as 'result')
- No breaking changes for agenda-report (until Phase 4)

---

## Contact & Support

For questions or issues during implementation:

1. Check MAIN_INDICATOR_ITEMS_GUIDE.md for detailed documentation
2. Review completed code in api/server.js and api.ts
3. Refer to TypeScript models for data structure
