# dsh-bangumi-account

让大肥鱼在 DSH 里拥有你的 Bangumi 账号：**在设置里登录，她既查得到番，也记得你的口味。**

- 宿主侧：`src/`（登录、同步、口味档案、7–8 个工具、`/dsh-bangumi/*` 接口）
- 浏览器侧：`client/client.js`（`设置 → Bangumi` 一页）
- 设计文档：[`docs/需求分析与功能设计.md`](./docs/需求分析与功能设计.md) ｜ 接口速查：[`docs/bangumi-api-cheatsheet.md`](./docs/bangumi-api-cheatsheet.md)

| 问题 | 现在 | 装上之后 |
|---|---|---|
| 鱼不知道主人喜欢什么 | 只能从聊天里猜 | 有一份从真实收藏算出来的口味档案 |
| 问「这部番怎么样」要人去开网页 | 只能凭训练数据瞎说 | 查评分、排名、制作方、集数、放送日 |
| 「最近有啥好看的」 | 泛泛而谈 | 结合口味 + 本季日历，给带理由的推荐 |
| 「我看到第几集了」 | 不知道 | 读 Bangumi 的实际进度 |

四个已定决策：原生插件（不做 MCP）；令牌登录为主；**不往上下文注入摘要**，只留 `bangumi_taste` 按需查询；写权限是设置开关、默认关。

## 安装

| 方式 | 命令 |
|---|---|
| 设置页 | 设置 → 插件 → 安装，输入 `dsh-bangumi-account` |
| 命令行 | `dsh plugin --profile web add dsh-bangumi-account` |
| 让 agent 装 | `plugin_manager install_bundle target="dsh-bangumi-account"` |
| 从 GitHub 直装 | `plugin_manager install_bundle target="github:<user>/dsh-bangumi-account"` |
| 本地开发 | `plugin_manager install_bundle target="D:\program\dsh-bangumi-account"` |

装完刷新一下页面（F5），`设置 → Bangumi` 才会出现——客户端插件在页面启动时加载，不刷新看不到。

维护者发布流程见 [`docs/PUBLISHING.md`](./docs/PUBLISHING.md)。

## 首次使用

1. 打开 <https://next.bgm.tv/demo/access-token>，生成个人访问令牌（Access Token）。
2. DSH `设置 → Bangumi`，把令牌粘进输入框，点「验证并保存」。
3. 点「立即同步」，等进度条走完。同步会把收藏、评分、进度拉到本地，并算出「口味档案」。
4. 之后直接跟鱼说话就行：

```
你：最近有啥好看的番？
鱼：（调 bangumi_recommend）……
你：我给《X》打了几分？
鱼：（调 bangumi_my_entry）……
你：还记得我喜欢什么类型吗？
鱼：（调 bangumi_taste）……
```

## 网络与代理

这台机器**直连 `api.bgm.tv` 不通**，必须走本地代理。插件按下面的顺序自动决定：

1. 设置页「高级 → 代理」里填的地址
2. 环境变量 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`
3. Windows「Internet 选项」里的系统代理（本机探测到 `http://127.0.0.1:7897`）
4. 直连

设置页「高级」里能看到当前实际用的是哪一条（`网络：http://127.0.0.1:7897（system）`），旁边还有「测试连接」。

## 工具

| 工具 | 需要登录 | 说明 |
|---|---|---|
| `bangumi_search` | 否 | 搜作品/角色/人物 |
| `bangumi_subject` | 否 | 作品详情（可附带角色、制作、关联、章节） |
| `bangumi_calendar` | 否 | 本周放送表 |
| `bangumi_taste` | 是 | 口味档案（summary / tags / rating / recent / creators） |
| `bangumi_my_list` | 是 | 我的收藏，可按状态、类型、评分、标签、年份、关键词筛 |
| `bangumi_my_entry` | 是 | 某部作品我的状态与进度 |
| `bangumi_recommend` | 是 | 基于口味的推荐，带可核对理由 |
| `bangumi_update` | 是 + 开关 | 改状态/评分/评论/进度；**开关默认关，关着时不注册** |

未登录时 `bangumi_*` 的「我的」类工具不会报错，而是返回一句「主人还没登录」，让模型能自然转述。

## 隐私

- **令牌**只存在凭据库（`ctx.credentials` 的 `dsh-bangumi-account/grant` 记录），没有凭据服务时退化为 `$DSH_HOME/bangumi-account/grant.json`（仅本人可读）。不写进 `cordis.patch.yml`，不进日志，不进对话，也不进工具返回值。
- **私有收藏**默认不进档案；**NSFW** 默认不进档案，且本地二次过滤（Bangumi 在无权限时会静默忽略 `nsfw` 参数）。
- 档案里只有统计与短评摘录，没有邮箱、UID、注册时间。
- 「高级」里有「导出我的数据」和「删除全部本地数据」。

## 数据落在哪

```
$DSH_HOME/bangumi-account/
├─ meta.json         账号、上次同步时间、计数
├─ collections.json  收藏快照
├─ profile.json      口味档案（含 version 哈希）
└─ subjects/<id>.json 条目缓存（默认 7 天）
```

## 排错

| 现象 | 处理 |
|---|---|
| 设置里看不到 Bangumi | 刷新页面（F5）；仍未出现就重启 DSH |
| 验证令牌报「令牌无效或已过期」 | 令牌复制不完整，或已在别处失效，重新生成 |
| 验证时报网络错误 | 看「高级 → 网络」是哪条路径；改代理或点「测试连接」 |
| 同步卡在 0 | 同上看代理；大账号首次同步可能几十秒 |
| 鱼说「还没同步」 | 去设置页点「立即同步」 |
| 改了开关没生效 | 配置写入会重载插件，几秒后自动恢复；刷新页面看状态 |

### 网络与代理排查

`api.bgm.tv` 在国内经常需要代理。插件按「配置 → 环境变量 → 系统代理 → 直连」选择路径，顺序和命中来源都会显示在「高级 → 网络」里。

怀疑是代理坏了，先用 curl 判断是谁的问题：

```powershell
curl.exe -sS -m 10 --proxy http://127.0.0.1:7897 -o NUL -w "%{http_code}`n" https://api.bgm.tv/calendar
```

- **curl 返回 200，插件仍失败** → 代理对 Node 的 TLS 做了限制。设置里把「代理」填成 `direct` 试直连，或换一个代理节点/端口。
- **curl 也失败** → 代理或线路本身不通，先修网络。

已知现象：某些代理配置下 curl 能通、Node 的 TLS 握手会一直挂住。插件为此加了 6 秒握手守卫，失败会返回 `TIMEOUT` 而不是无限等待。

## 开发

```powershell
npm test                         # 离线：宿主 72 + 接口 14 + 客户端 5，共 91 项
npm run test:live                # 真实 API（需要能访问 api.bgm.tv）
npm run check                    # 只做语法检查
```

单独跑某个套件：

```powershell
node scripts\host-tests.mjs      # 同步/档案/工具/写工具/推荐
node scripts\api-tests.mjs       # 限流、重试、错误映射、代理开关
node scripts\client-smoke.mjs    # 设置页四态渲染
node scripts\smoke.mjs           # 真实端点形状
node scripts\live-test.mjs       # 公开用户收藏 → 档案 → 工具
```

## 请求节流

默认每 300ms 才发一个请求（`requestIntervalMs`，可在 config 里改）。命中 429 会按 `Retry-After` 退避后重试；5xx 与网络错误只重试**读**请求——写请求绝不重试，避免重复写入。
