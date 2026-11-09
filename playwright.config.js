import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: { viewport: { width: 1280, height: 800 }, trace: "off" },
  webServer: [
    {
      command: "python3 -m http.server 8765 --bind 127.0.0.1",
      port: 8765,
      reuseExistingServer: false,
    },
    {
      command: "rm -rf /tmp/md-editor-qa && MOUNTAINDALE_DATA_DIR=/tmp/md-editor-qa node editor/server.mjs",
      port: 8766,
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "viewer", testMatch: /viewer/, use: { baseURL: "http://127.0.0.1:8765" } },
    { name: "editor", testMatch: /editor/, use: { baseURL: "http://127.0.0.1:8766" } },
  ],
});
