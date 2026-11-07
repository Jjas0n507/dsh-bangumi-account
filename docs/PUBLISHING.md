# 发布指南（GitHub + npm）

> 目标：任何人执行一条命令就能装上，且能在 DSH 的插件列表里看到它。

## 0. 发布前只有一件事必须先做

`package.json` 里补上你自己的仓库地址（npm 与 DSH 的插件页都会读它）：

```json
"repository": { "type": "git", "url": "git+https://github.com/<你的用户名>/dsh-bangumi-account.git" },
"homepage": "https://github.com/<你的用户名>/dsh-bangumi-account#readme",
"bugs": { "url": "https://github.com/<你的用户名>/dsh-bangumi-account/issues" }
```

再把 `LICENSE` 里的版权行改成你的名字或 ID。

## 1. 本地校验（发布前每次都跑）

```powershell
npm test                      # 91 项离线断言
npm pack --dry-run --json     # 看真正会被发布的文件清单
```

`npm pack` 的清单里**必须**包含：`src/`、`client/client.js`、`locale/*.json`、`icon.svg`、`cordis.patch.yml`。
常见错误是 `files` 漏了某个目录 → 用户装上了，但设置页 404 或工具不注册。

## 2. 建仓库并推送

```powershell
git init -b main
git config user.name  "你的名字"
git config user.email "你的邮箱"
git add .
git commit -m "feat: Bangumi account plugin for DSH"
git remote add origin https://github.com/<你的用户名>/dsh-bangumi-account.git
git push -u origin main
```

没有安装 `gh` 也可以在网页上新建空仓库，再执行上面最后两行。

## 3. 发布到 npm

```powershell
npm login          # 一次性
npm publish        # 包名 dsh-bangumi-account（已确认可用）
```

- 包名是**无 scope** 的，`publishConfig` 不需要额外配置。
- 发布后再改代码：`npm version patch`（或 minor/major）→ `git push --follow-tags` → `npm publish`。

## 4. 用户怎么装

**普通用户（Web/GUI）**：设置 → 插件 → 安装，输入包名：

```
dsh-bangumi-account
```

**用命令行**（`dsh` 需已安装；`desktop` 这个 profile 名归桌面端所有，npm 版 CLI 不接受，用它自带的命令）：

```powershell
dsh plugin --profile web add dsh-bangumi-account
```

**在对话里让 agent 装**：

```
plugin_manager install_bundle  target = "dsh-bangumi-account"
```

**从 GitHub 直装（不走 npm，适合开发版）**：

```
plugin_manager install_bundle  target = "github:<你的用户名>/dsh-bangumi-account"
```

DSH 的安装器会先 `git ls-remote` 探活仓库，再交给 pnpm 拉取。仓库直装拿不到 npm 的版本语义（没有 `listVersions` 更新提示），日常分发仍建议走 npm。

**本地目录（自己改代码时）**：

```
plugin_manager install_bundle  target = "D:\program\dsh-bangumi-account"
```

## 5. 装上之后会发生什么

1. 插件出现在「设置 → 插件」列表，标题/描述/图标来自 `locale/*.json` 与 `icon.svg`。
2. `设置 → Bangumi` 出现一个页面。
3. 工具 `bangumi_search` / `bangumi_subject` / `bangumi_calendar` / `bangumi_taste` / `bangumi_my_list` / `bangumi_my_entry` / `bangumi_recommend` 注册（`bangumi_update` 默认不注册）。
4. 刷新页面后设置页才可见——客户端插件在页面启动时加载。

## 6. 版本兼容

DSH 会用 `engines.dsh` 或 DSH peer 依赖校验运行版本。本包**故意不声明** `engines.dsh`：
一旦声明，严格范围会在 patch 版本升级后把老用户挡在门外，而这里只用到稳定服务（`tools`/`webServer`/`credentials`）。
如果将来用到实验性 API，再按运行时版本加范围，并在 README 写清最低版本。

## 7. 可选的额外曝光

- `dshmarket` 之类的第三方目录：按其提交规范提 PR（本机当前没有配置任何市场索引，`plugin_market list_indexes` 为空）。
- GitHub README 里的安装片段保持一行，是最有效的入口。

## 8. 发布检查清单

- [ ] `package.json` 的 `repository`/`homepage`/`bugs` 已填
- [ ] `LICENSE` 版权行已改
- [ ] `npm test` 全绿
- [ ] `npm pack --dry-run` 清单完整（见第 1 节）
- [ ] 版本号与 CHANGELOG/Release note 一致
- [ ] 发布后用一台干净环境实际装一次：设置页出现、登录成功、工具可见
