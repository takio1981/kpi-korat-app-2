#!/bin/bash

# กำหนดสีข้อความ
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=================================================${NC}"
echo -e "${YELLOW}   KORAT KPI APP - DEPLOYMENT SCRIPT (AUTO)      ${NC}"
echo -e "${YELLOW}=================================================${NC}"

# 0. Build Source Code (Local Build)
echo -e "\n${YELLOW}[STEP 0/4] กำลัง Build Source Code (API & Frontend)...${NC}"

# --- Build API ---
echo -e "${YELLOW}   -> Building API...${NC}"
cd api || { echo -e "${RED}✘ ไม่พบโฟลเดอร์ api${NC}"; exit 1; }
npm install
npm run build
if [ $? -ne 0 ]; then echo -e "${RED}✘ API Build Failed${NC}"; exit 1; fi
cd ..

# --- Build Frontend ---
echo -e "${YELLOW}   -> Building Frontend...${NC}"
cd frontend || { echo -e "${RED}✘ ไม่พบโฟลเดอร์ frontend${NC}"; exit 1; }
# ใช้ --legacy-peer-deps เพื่อแก้ปัญหา version conflict ของ ng2-charts
npm install --legacy-peer-deps
if [ $? -ne 0 ]; then echo -e "${RED}✘ Frontend Install Failed${NC}"; exit 1; fi
# ใช้ MSYS_NO_PATHCONV=1 เพื่อป้องกัน Git Bash บน Windows แปลง path (ให้ใช้ /kpikorat/ ได้ถูกต้อง)
MSYS_NO_PATHCONV=1 npm run build -- --base-href /kpikorat/
if [ $? -ne 0 ]; then echo -e "${RED}✘ Frontend Build Failed${NC}"; exit 1; fi

# FIX: ตรวจสอบว่า Angular สร้างโฟลเดอร์ซ้อนหรือไม่ (เช่น dist/frontend/) ถ้ามีให้ย้ายออกมา
if [ ! -f dist/index.html ]; then
    SUBDIR=$(ls -d dist/*/ 2>/dev/null | head -n 1)
    if [ -n "$SUBDIR" ]; then
        echo -e "${YELLOW}   -> Detected nested folder ($SUBDIR). Moving files to root of dist...${NC}"
        mv "$SUBDIR"* dist/ && rmdir "$SUBDIR"
    fi
fi

cd ..

echo -e "${GREEN}✔ Build Source Code สำเร็จ (เตรียมไฟล์ dist เรียบร้อย)${NC}"

# 1. อัปเดต Container (Start/Restart)
echo -e "\n${YELLOW}[STEP 1/1] อัปเดตและรีสตาร์ท Container (Fast Deploy)...${NC}"
# ใช้ up -d เพื่อเริ่มระบบถ้ายังไม่เริ่ม (และโหลด config ใหม่ถ้ามีแก้ docker-compose)
docker compose up -d
# รีสตาร์ทเพื่อโหลดโค้ดใหม่ (โดยเฉพาะ API ที่ต้อง reload process)
docker compose restart

if [ $? -eq 0 ]; then
    echo -e "${GREEN}=================================================${NC}"
    echo -e "${GREEN}   ✔ DEPLOYMENT SUCCESSFUL! (เสร็จสมบูรณ์)       ${NC}"
    echo -e "${GREEN}=================================================${NC}"
    echo -e "เข้าใช้งานได้ที่: ${YELLOW}http://localhost:8808${NC} (หรือ IP เครื่องนี้)"
    echo -e "ตรวจสอบสถานะ:   ${YELLOW}docker compose ps${NC}"
else
    echo -e "${RED}✘ ไม่สามารถเริ่มระบบได้${NC}"
    exit 1
fi
