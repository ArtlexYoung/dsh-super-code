// 运行：node --test test/builtin/workbench/git/panel.browser.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const require2 = createRequire(import.meta.url), { build } = require2("esbuild"), playwright = require2("playwright");
const fixture = `import React from "react";
import { createRoot } from "react-dom/client";
import { GitPanel } from "./builtin/workbench/git/Panel.jsx";
import { createChanges } from "./builtin/workbench/git/changes.js";
let value = state("initial"), gated = false, failure = false;
const requests = [];
function state(branch, paths = ["main.ts"], sources = []) {
  return { kind: "state", state: { exists: true, writable: true, version: branch, backend: "native", branch, head: "a".repeat(40), author: { name: "Demo", email: "demo@example.invalid" }, changes: paths.map((path) => ({ path, head: 1, stage: 1, worktree: 2 })), history: [], branches: [], remoteBranches: [], remotes: [] }, sources };
}
const changes = createChanges(async (input) => {
  if (failure) throw new Error("repository unavailable");
  if (gated) return new Promise((resolve) => requests.push(resolve));
  return value;
}, (error) => error.message);
let workbenchState={panel:{kind:"git"}};const subscribers=new Set();
const workbench = { subscribe: fn => {subscribers.add(fn);return ()=>subscribers.delete(fn)}, snapshot:()=>workbenchState, changes, git: changes.run, documents: /* @__PURE__ */ new Map(), refresh: async () => {
}, panel(panel) {workbenchState={...workbenchState,panel};for(const fn of subscribers)fn();
}, visit: async () => {
}, fail(error) {
  throw error;
} };
function Button({ children, ...props }) {
  return <button {...props}>{children}</button>;
}
function Select({ label, value: value2, choices, onChange }) {
  return <select aria-label={label} value={value2} onChange={(event) => onChange(event.target.value)}>{choices.map(([value3, label2]) => <option key={value3} value={value3}>{label2}</option>)}</select>;
}
const root = createRoot(document.getElementById("root"));
root.render(<GitPanel workbench={workbench} Button={Button} Select={Select} palette="idea" t={(key) => key} />);
window.test = { remotes: async (remotes) => {
  value = { ...value, state: { ...value.state, remotes: remotes.map(item => ({ ...item })) } };
  await changes.refresh();
}, change: async (branch, paths, sources) => {
  value = state(branch, paths, sources);
  await changes.refresh();
}, gated: () => {
  gated = true;
}, count: () => requests.length, run: () => changes.run({ action: "status" }), resolve: (i, branch, paths) => requests[i](state(branch, paths)), snapshot: changes.snapshot, failure: async () => {
  failure = true;
  await changes.refresh();
}, dispose: () => {
  root.unmount();
  changes.dispose();
} };
`;
const built = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: repo }, bundle: true, write: false, format: "esm", platform: "browser", loader: { ".css": "text" } });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/app.js" ? built.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"><\/script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright[process.env.SC_TEST_BROWSER || "chromium"].launch({ headless: true, executablePath: process.env.SC_TEST_EXECUTABLE || undefined });
try {
  await test("Git 面板使用共享仓库状态", async (t) => {
    const run = async (name, action) => t.test(name, async () => {
      const page = await browser.newPage();
      page.setDefaultTimeout(2500);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto("http://127.0.0.1:" + server.address().port);
        await page.locator('button[title="main.ts"]').waitFor();
        await action(page);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
    await run("后台刷新后文件列表、数量和分支同步", async (page) => {
      await page.evaluate(() => window.test.change("updated", ["other.py"]));
      await page.locator('button[title="other.py"]').waitFor();
      assert.equal(await page.locator('button[title="main.ts"]').count(), 0);
      assert.equal(await page.locator(".sc-wb-git-toolbar strong").textContent(), "updated");
      await page.evaluate(() => window.test.change("clean", []));
      await page.getByText("gitClean", { exact: true }).waitFor();
    });
    await run("删除原会话后自动退出已失效的来源筛选", async (page) => {
      await page.evaluate(() => window.test.change("source", ["main.ts"], [{ id: "old", name: "Old conversation", files: ["main.ts"] }]));
      await page.getByRole("combobox", { name: "gitSource" }).selectOption("old");
      await page.evaluate(() => window.test.change("source-deleted", ["other.py"], []));
      await page.locator('button[title="other.py"]').waitFor();
      assert.equal(await page.getByRole("combobox", { name: "gitSource" }).inputValue(), "all");
    });
    await run("较旧的手动刷新晚到不能覆盖较新的后台快照", async (page) => {
      await page.evaluate(() => window.test.gated());
      await page.locator('button[title="refresh"]').click();
      await page.waitForFunction(() => window.test.count() === 1);
      await page.evaluate(() => {
        window.test.run();
      });
      await page.waitForFunction(() => window.test.count() === 2);
      await page.evaluate(() => window.test.resolve(1, "newest", ["new.ts"]));
      await page.evaluate(() => window.test.resolve(0, "stale", ["old.ts"]));
      await page.waitForFunction(() => !document.querySelector(".sc-wb-git").getAttribute("aria-busy") || document.querySelector(".sc-wb-git").getAttribute("aria-busy") === "false");
      assert.equal(await page.evaluate(() => window.test.snapshot().state.branch), "newest");
      assert.equal(await page.locator(".sc-wb-git-toolbar strong").textContent(), "newest");
      await page.locator('button[title="new.ts"]').waitFor();
    });
    await run("后台刷新失败不隐藏错误且保留用户填写的提交信息", async (page) => {
      await page.getByRole("textbox", { name: "gitCommitMessage" }).fill("Keep this draft");
      await page.getByRole("textbox", { name: "gitAuthor" }).fill("My author");
      await page.evaluate(() => window.test.failure());
      await page.getByRole("alert").filter({ hasText: "repository unavailable" }).waitFor();
      assert.equal(await page.getByRole("textbox", { name: "gitCommitMessage" }).inputValue(), "Keep this draft");
      assert.equal(await page.getByRole("textbox", { name: "gitAuthor" }).inputValue(), "My author");
    });
    await run("后台刷新同一远程配置保留未保存地址，切换远程时读取对应地址", async (page) => {
      const remotes = [{ remote: "origin", url: "https://example.invalid/original.git" }, { remote: "backup", url: "https://example.invalid/backup.git" }];
      await page.evaluate((remotes) => window.test.remotes(remotes), remotes);
      await page.locator('button[title="git_remotes"]').click();
      const address = page.getByLabel("gitRemoteUrl", { exact: true });
      await address.fill("https://example.invalid/unsaved.git");
      await page.locator('button[title="gitManualCredential"]').click();
      await page.getByLabel("gitUsername", { exact: true }).fill("demo-user");
      await page.getByLabel("gitToken", { exact: true }).fill("not-a-secret");
      await page.evaluate((remotes) => window.test.remotes(remotes), remotes);
      await page.waitForFunction(() => !window.test.snapshot().busy);
      assert.equal(await address.inputValue(), "https://example.invalid/unsaved.git");
      assert.equal(await page.getByLabel("gitUsername", { exact: true }).inputValue(), "demo-user");
      assert.equal(await page.getByLabel("gitToken", { exact: true }).inputValue(), "not-a-secret");
      await page.getByRole("combobox", { name: "gitRemote", exact: true }).selectOption("backup");
      await page.waitForFunction(() => document.querySelector('input').value === "backup");
      assert.equal(await address.inputValue(), remotes[1].url);
    });
    await run("无远程时编辑新地址，空列表刷新和失败恢复都保留草稿", async (page) => {
      await page.locator('button[title="git_remotes"]').click();
      const address = page.getByLabel("gitRemoteUrl", { exact: true });
      await address.fill("https://example.invalid/new.git");
      await page.evaluate(() => window.test.remotes([]));
      assert.equal(await address.inputValue(), "https://example.invalid/new.git");
      await page.evaluate(() => window.test.failure());
      await page.getByRole("alert").filter({ hasText: "repository unavailable" }).waitFor();
      assert.equal(await address.inputValue(), "https://example.invalid/new.git");
    });
    await run("实际保存地址发生变化时读取新值，不依赖列表对象引用", async (page) => {
      await page.evaluate(() => window.test.remotes([{ remote: "origin", url: "https://example.invalid/old.git" }]));
      await page.locator('button[title="git_remotes"]').click();
      const address = page.getByLabel("gitRemoteUrl", { exact: true });
      await page.waitForFunction(() => document.querySelector('input[placeholder="HTTPS / SSH"]')?.value === "https://example.invalid/old.git");
      assert.equal(await address.inputValue(), "https://example.invalid/old.git");
      await page.evaluate(() => window.test.remotes([{ remote: "origin", url: "https://example.invalid/saved.git" }]));
      await page.waitForFunction(() => document.querySelector('label input[autocomplete="off"]').value === "https://example.invalid/saved.git");
      assert.equal(await address.inputValue(), "https://example.invalid/saved.git");
    });
    for (const mode of ["mouse-escape", "mouse-cancel", "keyboard-escape"]) await run(`Git 确认取消后恢复发起按钮焦点：${mode}`, async (page) => {
      await page.locator('button[title="git_remotes"]').click();
      await page.getByLabel("gitRemoteUrl", { exact: true }).fill("https://example.invalid/review.git");
      const button = page.locator('button[title="gitSaveRemote"]');
      if (mode === "keyboard-escape") { await button.focus(); await page.keyboard.press("Enter"); }
      else await button.click();
      const dialog = page.getByRole("alertdialog");
      await dialog.waitFor();
      if (mode === "mouse-cancel") await dialog.getByRole("button", { name: "gitCancel", exact: true }).click();
      else await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(await button.evaluate(node => node === document.activeElement), true);
      await page.keyboard.press("Enter");
      await dialog.waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(await page.getByLabel("gitRemoteUrl", { exact: true }).inputValue(), "https://example.invalid/review.git");
    });
  });
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
