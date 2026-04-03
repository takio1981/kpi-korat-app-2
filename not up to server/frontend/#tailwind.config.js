/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sarabun: ['Sarabun', 'sans-serif'],
      },
      colors: {
        // เราจะ "สวมรอย" ทับสี Teal เดิม ด้วยสีเขียวชุดใหม่ของคุณ
        teal: {
          50: '#F3FAF3',
          100: '#E3F5E3',
          200: '#C9E9C9',
          300: '#9ED7A0',
          400: '#6CBC6E',
          500: '#449747' /* สีหลัก (Primary) */,
          600: '#37823A',
          700: '#2E6730' /* สีปุ่ม Hover / หัวตาราง */,
          800: '#28532A' /* สีตัวหนังสือเข้ม */,
          900: '#234425',
          950: '#0E2510',
        },
      },
    },
  },
  plugins: [],
};
