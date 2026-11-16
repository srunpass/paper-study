import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 将本地 AI 请求转发到只监听回环地址的服务。 */
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:4318' } },
  build: { chunkSizeWarningLimit: 1500 },
});
