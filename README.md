# dsh-plan-usage

在 DeepSeek Harness 的 Web 对话框**右下角**显示套餐用量角标（当前支持 **OpenCode Go** 套餐），实时展示三个用量窗口：

- **5小时**（$12 / 5 小时滚动窗口）
- **周限**（$30 / 周）
- **月限**（$60 / 月）

胶囊标签标注套餐名（当前为 `OpenCode Go 用量`），默认显示 `19% 65% 35%`（顺序：5小时 → 周限 → 月限），圆点颜色按最差窗口分级（<50% 绿 / 50–89% 黄 / ≥90% 红）。点击胶囊展开面板，可看到每个窗口的进度条与重置倒计时，每 60 秒自动刷新。

![dsh-plan-usage 效果图](dsh-plan-usage.png)

## 配置

装好后，在 **设置 → 插件 → 插件配置** 里会出现「套餐用量」卡片（默认折叠，点击标题栏展开/收起；外观与内置的「终端 / Agent 循环 / 网页搜索」卡片保持一致——同样的折叠头部、未保存徽标、底部「放弃修改 / 保存 / 保存中…」按钮与配色）。卡片标题不绑定具体套餐；当前只接入 **OpenCode Go** 一个套餐，开关与 API Key 都是该套餐专属的，因此标注套餐名：

- **启用 OpenCode Go 用量角标**：开关，关闭后右下角角标不再显示（默认开启）。
- **OpenCode Go API Key（可选）**：启用开关后显示的输入框，用于填入本插件专用的 API Key。

后续支持更多套餐时，每个套餐将对应自己的开关与 API Key 配置项。

API Key 的解析优先级：

1. 插件配置卡片里填入的 API Key（最高）；
2. **设置 → 模型 → 提供方选 `opencode-go`** 里保存的 API Key（即凭据 `OPENCODE_GO_API_KEY`）；
3. 环境变量 `OPENCODE_GO_API_KEY`（或 `OPENCODE_API_KEY`）。

卡片里的 Key 留空时回退到上面的 2/3；如果两边都没设置，右下角胶囊会提示「请设置 Key」。

## 前置条件

在 harness 的凭据库（`~/.dsh/.credentials.yaml`）或进程环境中配置 OpenCode Go 的 API Key：

- 推荐：**设置 → 模型 → 提供方选 `opencode-go` → 填入 API Key 保存**（会自动写入凭据名 `OPENCODE_GO_API_KEY`）。
- 或：在 **设置 → 插件 → 插件配置** 的「OpenCode Go 用量」卡片里直接填入 Key。
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
├── index.js           # Host 半：注册 GET /api/plan-usage + GET/POST /api/plan-usage/config
└── client.js          # 浏览器半：右下角用量角标（shell.overlay）+ 插件配置卡片（settings.plugin.item）
```

## 工作原理

- **Host 半**（`index.js`）：`webServer` 注册 `GET /api/plan-usage`，并按优先级解析 API Key（插件配置 `apiKey` → 凭据 `OPENCODE_GO_API_KEY`/`OPENCODE_API_KEY`），通过 `shell` 执行 `curl` 拉取 `https://opencode.ai/zen/go/v1/usage`，归一化后返回 JSON；同时注册 `plan-usage` 设置命名空间（`enabled` 开关 + `apiKey` 密钥，后者 `role('secret')`）作为配置的持久化存储，并注册 `GET/POST /api/plan-usage/config` 供浏览器读写配置。
- **浏览器半**（`client.js`）：以 `window.__ModuleLoader__.load` 闭包工厂注册到客户端模块表，在 `shell.overlay` 插槽渲染角标（`fetch('/api/plan-usage')` 同源取数、每 60 秒轮询，并随 `enabled` 开关显示/隐藏），在 `settings.plugin.item` 插槽渲染配置卡片。

> 配置卡片不依赖 harness 的「配置客户端命名空间白名单」：浏览器端通过插件自己的 `/api/plan-usage/config` 路由读写，Host 端用 in-process 的设置命名空间持久化。因此**安装本插件无需修改 harness 源码**。

## 本地开发（不必先打包）

在源码 checkout 里，可直接用 `--patch` overlay 快速调试：

```sh
pnpm dsh web --patch ./cordis.patch.yml
```

调试 OK 后按上面的方式打包分发。

## License

MIT
