# Quick Reference: Main Indicator Items Enhancement

## 📊 What Was Built

### Database Changes

```sql
-- Existing table extended
ALTER TABLE kpi_main_records
  ADD item_id INT,           -- Links to 31 KPI items
  ADD is_visible TINYINT;    -- Show/hide flag

-- New configuration table
CREATE TABLE main_indicator_item_config (
  main_ind_id, item_id,
  agenda_field,  -- Which field (target/result/sub_result/custom)
  sort_order,    -- Display order (0=hidden)
  is_hidden      -- Visibility control
);
```

### API Endpoints (10 Total)

| Method | Endpoint                               | Purpose                 |
| ------ | -------------------------------------- | ----------------------- |
| GET    | `/main-records-items`                  | Get item data           |
| GET    | `/main-indicator-items`                | Get items for indicator |
| GET    | `/main-indicator-config`               | Get configuration       |
| POST   | `/main-records-items/batch`            | Save item data          |
| POST   | `/main-indicator-config/update`        | Save configuration      |
| POST   | `/main-records-items/visibility/batch` | Toggle visibility       |
| GET    | `/main-indicator-summary`              | Summary data            |
| DELETE | `/main-indicator-config/:id`           | Delete config           |

### Frontend Code

**API Service Methods** (8 methods in api.ts)

```typescript
// Get data
getMainRecordsItems();
getMainIndicatorItems();
getMainIndicatorConfig();
getMainIndicatorSummary();

// Save data
saveMainRecordsItemsBatch();
updateMainIndicatorConfig();
updateMainRecordsItemsVisibility();
deleteMainIndicatorConfig();
```

**Component Methods** (in provincial-kpi.ts)

```typescript
loadMainIndItems(mainInd)            // Load 31 items
loadMainIndItemValues(mainInd)       // Load values
getMainIndItemValue(...)             // Get value
onMainIndItemValueChange(...)        // Handle edit
confirmSaveMainInd() [UPDATED]       // Save both aggregate + items
```

**TypeScript Models** (12 interfaces in main-indicator.model.ts)

```typescript
MainIndicatorRecord
MainIndicatorItemConfig
MainIndicatorItem
MainRecordChange
MainIndicatorSummary
... (7 more)
```

---

## 🎯 Current Features

✅ **Supported**:

- Store 31 item values per main indicator per month
- Show/hide items with is_visible flag
- Map items to agenda-report fields
- Audit trail of changes
- Backward compatible with aggregate values

❌ **Not Yet**:

- UI for showing 31 items (HTML needed)
- Configuration management page
- Agenda-report using configuration

---

## 📝 Usage Example

### 1. Record Item Data (Provincial KPI Admin)

```typescript
// In provincial-kpi component
this.api
  .saveMainRecordsItemsBatch({
    fiscalYear: 2569,
    amphoe_name: "นครราชสีมา",
    main_ind_id: 1,
    changes: [
      { item_id: 1, month: 10, value: 100 },
      { item_id: 2, month: 10, value: 200 },
      { item_id: 3, month: 10, value: 150 },
    ],
  })
  .subscribe((res) => console.log("Saved", res.count, "items"));
```

### 2. Configure Item Mapping (Admin Setup)

```typescript
// Future: Configuration component
this.api
  .updateMainIndicatorConfig({
    main_ind_id: 1,
    item_id: 1,
    agenda_field: "result", // Will appear as 'result' in report
    sort_order: 1, // Display order
    is_hidden: 0, // Can be hidden by user
  })
  .subscribe((res) => console.log("Config saved"));
```

### 3. Use in Agenda Report (Auto)

```typescript
// Future: Agenda-report component (to be updated)
// Load configuration
const config = await api.getMainIndicatorConfig(mainIndId);

// Get items mapped to 'result' field
const resultItems = config.filter((c) => c.agenda_field === "result");

// Calculate value from those items
const resultValue = recordedItems
  .filter((r) => resultItems.includes(r.item_id) && r.is_visible)
  .reduce((sum, r) => sum + r.kpi_value, 0);
```

---

## 🚀 Next Steps (Priority Order)

### Step 1: Apply Database Migration (5 minutes)

```bash
cd korat-kpi-app
mysql -u root -p korat_db < database/migration_v7_main_ind_items.sql
```

### Step 2: Test API Endpoints (10 minutes)

```bash
# Start backend (if not running)
cd api && npm start

# Test endpoints
curl http://localhost:3000/kpikorat/api/main-indicator-items?main_ind_id=1
curl http://localhost:3000/kpikorat/api/main-records-items?fiscalYear=2569
```

### Step 3: Add UI to Provincial KPI (2-3 hours)

File: `frontend/src/app/provincial-kpi/provincial-kpi.html`

Add expandable grid showing:

- Item name & unit
- 12 month columns (Oct-Sep)
- Edit inputs (when in edit mode)
- Show template in: MAIN_INDICATOR_ITEMS_GUIDE.md

### Step 4: Create Configuration Component (4-5 hours)

File: `frontend/src/app/admin/main-indicator-config/`

Features:

- Select main indicator
- List all 31 items
- For each item: set target/result/sub_result field
- Save to database

### Step 5: Update Agenda Report (2-3 hours)

File: `frontend/src/app/agenda-report/agenda-report.ts`

Changes:

- Load item configuration
- Calculate values from configured items
- Build report using items instead of aggregate

---

## 📖 Documentation Files

| File                              | Content                           |
| --------------------------------- | --------------------------------- |
| **MAIN_INDICATOR_ITEMS_GUIDE.md** | Complete guide with code examples |
| **IMPLEMENTATION_STATUS.md**      | Project overview & phase tracking |
| **main-indicator.model.ts**       | All TypeScript interfaces         |
| **This file**                     | Quick reference                   |

---

## 💡 Key Design Decisions

1. **Item-level Storage**
   - Each item can be recorded separately
   - Values stored in kpi_main_records with item_id
   - Null item_id = aggregate value (backward compatible)

2. **Configuration-Driven**
   - Mapping is flexible and changeable
   - Items can be mapped to different report fields
   - Easy to add new fields (target, result, sub_result, custom)

3. **Visibility Control**
   - is_visible flag on records
   - Hides items from report/summary
   - Separate from configuration (user vs admin setting)

4. **Audit Trail**
   - All changes logged to main_record_audit
   - Track who changed what and when
   - Useful for compliance/oversight

---

## 🔧 Troubleshooting

| Problem                   | Solution                                       |
| ------------------------- | ---------------------------------------------- |
| API returns 404           | Check server.js has endpoints (line 1495+)     |
| API service undefined     | Import from services/api.ts                    |
| Items not loading         | Verify getMainIndicatorItems() returns data    |
| Save fails                | Check JWT token, user role = admin             |
| Configuration not working | Ensure main_indicator_item_config table exists |

---

## 📚 Related Documentation

- See **MAIN_INDICATOR_ITEMS_GUIDE.md** for:
  - Detailed API endpoint specs
  - HTML template examples
  - Configuration UI patterns
  - Database maintenance queries

- See **IMPLEMENTATION_STATUS.md** for:
  - Complete project phase breakdown
  - Architecture diagrams
  - Testing commands
  - Deployment checklist

---

## ✨ After Completion

Once fully implemented, users will:

1. ✅ Record all 31 items for each main indicator
2. ✅ Show/hide items as needed
3. ✅ Configure which items feed into which report fields
4. ✅ See detailed breakdown in agenda-report
5. ✅ Track changes via audit log

---

## 📞 Support Quick Links

- Database Issues: See MAIN_INDICATOR_ITEMS_GUIDE.md → Database Queries
- API Testing: See IMPLEMENTATION_STATUS.md → Testing Commands
- UI Examples: See MAIN_INDICATOR_ITEMS_GUIDE.md → Frontend UI
- Component Logic: See provincial-kpi.ts (methods added)
