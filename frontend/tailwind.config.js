/** @type {import('tailwindcss').Config} */
export default {
  content:['./index.html','./src/**/*.{js,ts,jsx,tsx}'],
  theme:{extend:{colors:{pine:{950:'#0e302b',900:'#123e35',800:'#1b5247',700:'#286e5c',600:'#32866f'},
          cream:'#f8f9f6',coral:'#f58464',mint:'#e4f5eb',ink:'#1c302c',muted:'#7e9189'},
          boxShadow:{card:'0 7px 35px rgba(26,66,53,.045)',float:'0 16px 55px rgba(20,58,47,.14)'},
          borderRadius:{card:'22px'}}},plugins:[]
}
