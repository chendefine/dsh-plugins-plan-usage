# dsh-plan-usage

在 DeepSeek Harness 的 Web 对话框**右下角**显示 **OpenCode Go 套餐**的用量角标，实时展示三个用量窗口：

- **5小时**（$12 / 5 小时滚动窗口）
- **周限**（$30 / 周）
- **月限**（$60 / 月）

胶囊默认显示 `19% 65% 35%`（顺序：5小时 → 周限 → 月限），圆点颜色按最差窗口分级（<50% 绿 / 50–89% 黄 / ≥90% 红）。点击胶囊展开面板，可看到每个窗口的进度条与重置倒计时，每 60 秒自动刷新。

## 前置条件

在 harness 的凭据库（`~/.dsh/.credentials.yaml`）或进程环境中配置 OpenCode Go 的 API Key：

- 推荐：**设置 → 模型 → 提供方选 `opencode-go` → 填入 API Key 保存**（会自动写入凭据名 `OPENCODE_GO_API_KEY`）。
- 或：导出环境变量 `OPENCODE_GO_API_KEY`（或 `OPENCODE_API_KEY`）。

## 安装

这是一个 DSH **bundle**（组合包）。用 `dsh plugin` 安装到某个 profile：

```sh
# 1) 从 GitHub 源码安装（建议锁定 commit）
dsh plugin --profile web add "github:you/dsh-plan-usage#<sha>"

# 2) 从 npm 安装（作者已发布）
dsh plugin --profile web add dsh-plan-usage

# 3) 本地目录 / tarball
dsh plugin --profile web add ./dsh-plan-usage
dsh plugin --profile web add ./dsh-plan-usage-0.1.0.tgz
```

装完验证并启动：

```sh
dsh --profile web --dump-config   # 确认出现 "# == dsh-plan-usage" 层
dsh web
```

> 本插件是**纯 JS、零构建**：GitHub 源码安装时没有 `prepare` 脚本，因此**不需要**在 profile 的 `pnpm-workspace.yaml` 里配置 `allowBuilds`。

## 目录结构

```
dsh-plan-usage/
├── package.json       # 声明 dsh.bundle（host 配置层）+ dsh.client（浏览器半）
├── cordis.patch.yml   # 贡献的配置层（插入 plan-usage 行）
├── index.js           # Host 半：注册 GET /api/plan-usage（解析 Key + curl 取数）
└── client.js          # 浏览器半：右下角用量角标（shell.overlay）
```

## 工作原理

- **Host 半**（`index.js`）：`webServer` 注册 `GET /api/plan-usage`，解析 `OPENCODE_GO_API_KEY` 凭据，通过 `shell` 执行 `curl` 拉取 `https://opencode.ai/zen/go/v1/usage`，归一化后返回 JSON。
- **浏览器半**（`client.js`）：以 `window.__ModuleLoader__.load` 闭包工厂注册到客户端模块表，在 `shell.overlay` 插槽渲染角标，`fetch('/api/plan-usage')` 同源取数并每 60 秒轮询。

## 本地开发（不必先打包）

在源码 checkout 里，可直接用 `--patch` overlay 快速调试：

```sh
pnpm dsh web --patch ./cordis.patch.yml
```

调试 OK 后按上面的方式打包分发。

## License

MIT
