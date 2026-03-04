FROM nginx:alpine

# ลบ Config เดิมของ Nginx (เพื่อใช้ Config ของเราเอง)
RUN rm /etc/nginx/conf.d/default.conf

# Copy Config ใหม่
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy ไฟล์ที่ Build แล้ว (จากเครื่อง Host) เข้า Container
# หมายเหตุ: ตรวจสอบว่าใน dist/ มีไฟล์ index.html อยู่โดยตรง หรืออยู่ในโฟลเดอร์ย่อย (เช่น dist/korat-kpi-app/)
COPY dist/ /usr/share/nginx/html/kpikorat/

# กำหนดสิทธิ์ให้ Nginx อ่านไฟล์ได้แน่นอน (แก้ปัญหา 403 Forbidden ในบาง Environment)
RUN chmod -R 755 /usr/share/nginx/html/kpikorat/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
