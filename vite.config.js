import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), basicSsl()],
  server: {
    host: '0.0.0.0', // 监听所有网络接口，允许通过IP访问
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://192.168.0.22:3000',
        // target: 'http:///192.168.42.108:3000',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
