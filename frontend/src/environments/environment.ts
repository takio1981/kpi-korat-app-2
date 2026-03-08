export const environment = {
  production: false,
  // ใช้ relative path — Nginx จะ proxy ไปหา API container ให้อัตโนมัติ
  // ไม่ต้อง config IP/Port ใดๆ ทำให้ deploy ที่เครื่องไหนก็ได้
  apiUrl: '/kpikorat/api'
};
