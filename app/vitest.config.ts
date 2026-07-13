import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // globals:true で @testing-library/react の自動 cleanup が afterEach に登録される
    // (これが無いと複数 it をまたいで DOM が積み上がり "Found multiple elements" で落ちる)。
    globals: true,
    // コンポーネントテスト(.tsx)は各ファイル先頭の `// @vitest-environment jsdom`
    // docコメントで jsdom を選択する(vitest 3 は環境コメントを最優先で解釈)。
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
  },
});
