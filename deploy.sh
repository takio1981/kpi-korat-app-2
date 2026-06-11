#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
#  KORAT KPI APP - DEPLOY SCRIPT (Linux / macOS / Git Bash)
#  ใช้บน production server หรือ CI/CD pipeline
# ─────────────────────────────────────────────────────────────────────────

set -e  # หยุดทันทีเมื่อ command ใด return non-zero

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✔ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✘ $1${NC}"; }

echo -e "${YELLOW}"
echo "╔══════════════════════════════════════════════════╗"
echo "║     KORAT KPI APP - DEPLOYMENT SCRIPT           ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Pre-flight checks ───────────────────────────────────────────────
log "Pre-flight checks..."

if [ ! -f .env ]; then
    fail "ไม่พบไฟล์ .env — กรุณาสร้างจาก .env.example"
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon ไม่ได้รัน"
    exit 1
fi

ok "Pre-flight passed"
echo

# ─── [1/4] Build API ─────────────────────────────────────────────────
log "[1/4] Building API (Node.js)..."
cd api
npm install --omit=dev 2>&1 | tail -3
npm run build
ok "API build สำเร็จ → api/dist/server.js"
cd ..
echo

# ─── [2/4] Build Frontend ────────────────────────────────────────────
log "[2/4] Building Frontend (Angular)..."
cd frontend
npm install --legacy-peer-deps 2>&1 | tail -3

# ป้องกัน Git Bash แปลง path บน Windows
MSYS_NO_PATHCONV=1 npm run build -- --base-href /kpikorat/
ok "Frontend build สำเร็จ → frontend/dist/browser/"
cd ..
echo

# ─── [3/4] Build Docker Images ───────────────────────────────────────
log "[3/4] Building Docker images (using layer cache)..."
docker compose build --parallel
ok "Docker images ready"
echo

# ─── [4/4] Deploy Containers ─────────────────────────────────────────
log "[4/4] Starting containers..."

# Stop gracefully (ไม่ลบ network/volume)
docker compose stop 2>/dev/null || true

# Start with new images, force recreate
docker compose up -d \
    --force-recreate \
    --no-build \
    --remove-orphans

ok "Containers started"
echo

# ─── Verify ──────────────────────────────────────────────────────────
log "Waiting 8s for containers to initialize..."
sleep 8

echo
docker compose ps
echo

echo -e "${GREEN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✔  DEPLOYMENT SUCCESSFUL!                      ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Frontend : http://$(hostname -I | awk '{print $1}'):8808/kpikorat/  ║"
echo "║  API      : http://localhost:8809/kpikorat/api/  ║"
echo "║                                                  ║"
echo "║  Logs    : docker compose logs -f               ║"
echo "║  Status  : docker compose ps                    ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
