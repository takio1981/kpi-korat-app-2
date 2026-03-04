FROM node:18-alpine

WORKDIR /app

# ติดตั้ง PM2 แบบ Global
RUN npm install -g pm2

# Copy package.json และติดตั้ง Dependencies
COPY package.json ./
RUN npm install --production

# Copy PM2 Config
COPY ecosystem.config.js ./

# Copy โค้ดที่ Build/เตรียมไว้แล้ว (dist)
COPY dist/ ./dist/

EXPOSE 8809

# รันด้วย PM2 Runtime (สำหรับ Docker)
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
