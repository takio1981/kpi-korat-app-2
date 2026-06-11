FROM node:18-alpine

WORKDIR /app

# Layer 1: pm2 (cached เว้นแต่เปลี่ยน base image)
RUN npm install -g pm2 --no-update-notifier

# Layer 2: dependencies (cached ตราบที่ package*.json ไม่เปลี่ยน)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Layer 3: built code (invalidates only when dist/ changes)
COPY dist/ ./dist/
COPY ecosystem.config.js ./

EXPOSE 8809

CMD ["pm2-runtime", "ecosystem.config.js"]
