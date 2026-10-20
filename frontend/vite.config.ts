import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    host: '0.0.0.0',
    port: 5173,
    // 代理目标写 127.0.0.1 而不是 localhost：
    // Node 18+ 会优先把 localhost 解析成 IPv6 的 ::1，而 Spring Boot 的
    // Tomcat 默认只监听 IPv4，结果就是偶发的 ERR_CONNECTION_REFUSED——
    // 页面时好时坏，很难定位。写死 IPv4 可以消除这个不确定性。
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } },
    watch: {
      // 工具链在 src 下写文件时会留下形如
      // `.Foo.tsx.<pid>.<uuid>.tmpdir/Foo.tsx.tmp` 的临时目录。
      // 它们在写入的瞬间会被 Vite 的 fs watcher 捕获并加锁，
      // Windows 上直接抛 `EBUSY: resource busy or locked` 让整个
      // 开发服务器退出。忽略这些临时产物，避免编辑源码时服务被拖崩。
      ignored: ['**/.*.tmpdir/**', '**/*.tmp'],
    },
  },

  preview: { host: '0.0.0.0', port: 4173 },

  build: {
    // 拆出体积大且很少变动的第三方库。原先打成一个 829 kB 的 chunk，
    // 每次改业务代码都会让浏览器重新下载整包；分开后 React 与图表库
    // 可以长期命中缓存，只有应用代码那一小块需要重新校验。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'vendor-charts'
          if (id.includes('react-router')) return 'vendor-router'
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react'
          return 'vendor'
        },
      },
    },
    // 单个 chunk 超过 600 kB 才提示，避免正常的图表库体积刷屏。
    chunkSizeWarningLimit: 600,
  },
})
