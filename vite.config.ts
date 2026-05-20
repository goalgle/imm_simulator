import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 게임: GitHub Pages 등 서브패스 호스팅 대응 — 모든 자산을 상대 경로로 참조.
  //   루트 호스팅이든 /repo-name/ 서브패스든 동일하게 동작.
  base: './',
  server: {
    port: 5173,
    host: true,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
