# Bangumi API 速查（v0）

> 实现时用。来源：[`bangumi/api`](https://github.com/bangumi/api) 的 `open-api/v0.yaml`、`docs-raw/How-to-Auth.md`、`docs-raw/user agent.md`。
> 标 ⚠️ 的是官方标注「实验性 / 未实现 / 服务端与文档不一致」的项。

## 1. 基础

| 项 | 值 |
|---|---|
| API 根 | `https://api.bgm.tv` |
| 授权/令牌根 | `https://bgm.tv`（**与 API 不同域**） |
| 鉴权头 | `Authorization: Bearer <token>` |
| 公开读 | 不需要 token（`security: OptionalHTTPBearer`） |
| 需要 token | `/v0/me`、所有写操作、私有收藏 |
| 错误体 | `{ "title": "...", "description": "...", "details": {...} }` |
| UA | 必须含开发者 ID + 应用名，开源项目带主页；禁用默认 UA / `Bangumi/1.0` |

---

## 2. 登录与令牌

### 2.1 个人访问令牌（推荐路径）
- 入口：<https://next.bgm.tv/demo/access-token>（社区通行；若页面迁移，以 bgm.tv 用户设置里的入口为准）
- 校验：`GET /v0/me`

### 2.2 OAuth authorization code

```
GET https://bgm.tv/oauth/authorize
    ?client_id=<App ID>
    &response_type=code
    &redirect_uri=<后台登记的回调>
    &state=<随机>
```

回调：`<redirect_uri>?code=<CODE>&state=...`，**code 有效期 60 秒**。

```
POST https://bgm.tv/oauth/access_token
Content-Type: application/json 或 form
{
  "grant_type": "authorization_code",
  "client_id": "...", "client_secret": "...",
  "code": "...", "redirect_uri": "...", "state": "..."
}
→ { "access_token": "...", "expires_in": 604800, "token_type": "Bearer",
    "scope": null, "refresh_token": "...", "user_id": 123 }
```

刷新：

```
POST https://bgm.tv/oauth/access_token
{ "grant_type": "refresh_token", "client_id", "client_secret",
  "refresh_token", "redirect_uri" }
```

状态查询：

```
POST https://bgm.tv/oauth/token_status { "access_token": "..." }
→ { access_token, client_id, expires, scope, user_id }
```

⚠️ `scope` **尚未实现**：授权时无法请求细分权限，但规范给写接口标了 `write:collection` / `write:indices`；403 时按此提示。

---

## 3. 本插件用到的端点

### 3.1 用户

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v0/me` | 当前 token 的用户；额外返回 `email`、`reg_time`、`time_offset`（**email 要丢弃**） |
| GET | `/v0/users/{username}` | 公开资料；`username` 也可传 UID |
| GET | `/v0/users/{username}/avatar?type=small\|medium\|large` | 302 跳头像 |

`User`：`id, username, nickname, user_group, avatar{large,medium,small}, sign, url`

### 3.2 收藏（核心）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v0/users/{username}/collections?subject_type=&type=&limit=&offset=` | 用户收藏；私有需 token。返回 `Paged<UserSubjectCollection>` |
| GET | `/v0/users/{username}/collections/{subject_id}` | 单条；未收藏/私有返回 404 |
| POST | `/v0/users/-/collections/{subject_id}` | 新增或修改；body `UserSubjectCollectionModifyPayload`；204 |
| PATCH | `/v0/users/-/collections/{subject_id}` | 修改；字段全可选；204 |
| GET | `/v0/users/-/collections/{subject_id}/episodes?offset=&limit=&episode_type=` | 我的章节进度；`Paged<UserEpisodeCollection>` |
| PUT | `/v0/users/-/collections/-/episodes/{episode_id}` | 标记单集状态；body `{ "type": 0-3 }`；204 |
| GET | `/v0/users/{username}/collections/-/characters` | 角色收藏 |
| GET | `/v0/users/{username}/collections/-/persons` | 人物收藏 |

`UserSubjectCollection`：

```ts
{ subject_id, subject_type?, rate?, type?, comment?, tags?: string[],
  ep_status?, vol_status?, updated_at?, private?, subject?: SlimSubject }
```

`UserSubjectCollectionModifyPayload`：`type, rate, ep_status, vol_status, comment, tags, private`，全部可选。

### 3.3 条目 / 章节

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v0/subjects?type=&cat=&year=&month=&sort=&limit=&offset=` | 浏览；`type` 必填；首页 cache 24h |
| GET | `/v0/subjects/{id}` | 详情；cache 300s |
| GET | `/v0/subjects/{id}/persons` | 制作人员（`relation` 如「动画制作」「原作」） |
| GET | `/v0/subjects/{id}/characters` | 角色（含 `actors` 声优） |
| GET | `/v0/subjects/{id}/subjects` | 关联条目（`relation` 如前传/续集/同一系列） |
| GET | `/v0/episodes?subject_id=&type=&limit=&offset=` | 章节列表（limit ≤ 200，默认 100） |
| GET | `/v0/episodes/{id}` | 单章详情 |

`Subject`：`id, type, name, name_cn, summary, series, nsfw, locked, date, platform, images, infobox, volumes, eps, total_episodes, rating{rank,total,count{1..10},score}, collection{wish,collect,doing,on_hold,dropped}, meta_tags, tags[{name,count,total_count}]`

`SlimSubject`：`id, type, name, name_cn, short_summary, date, images, volumes, eps, collection_total, score, rank, tags[≤10]`

`Episode`：`id, type, name, name_cn, sort, ep, airdate, comment, duration, desc, disc, duration_seconds, subject_id`

`infobox` 是 `[{ key, value: string | [{k?,v}] }]`，常用 key：`简体中文名`、`别名`、`动画制作`、`原作`、`作者`、`出版社`、`游戏类型`。**这是拿「制作方/作者」最省的路径**（一次详情请求即可，不必再请求 persons）。

### 3.4 角色 / 人物

| 方法 | 路径 |
|---|---|
| GET | `/v0/characters/{id}`、`/image?type=`、`/subjects`、`/persons` |
| GET | `/v0/persons/{id}`、`/image?type=`、`/subjects`、`/characters` |
| POST/DELETE | `/v0/characters/{id}/collect`、`/v0/persons/{id}/collect`（⚠️ DELETE 服务端未实现，见 [bangumi/api#234](https://github.com/bangumi/api/issues/234)） |

### 3.5 搜索 ⚠️（实验性）

```
POST /v0/search/subjects?limit=&offset=
{ "keyword": "...",
  "sort": "match" | "heat" | "rank" | "score",
  "filter": {
    "type": [1,2,3,4,6],
    "tag": ["科幻","原创"],          // 且
    "meta_tags": ["童年","-科幻"],   // 且，可用 - 排除
    "air_date": [">=2020-07-01","<2020-10-01"],
    "rating": [">=6","<8"],
    "rating_count": [">=200"],
    "rank": [">10","<=18"],
    "nsfw": false
  } }
```

`POST /v0/search/characters`、`POST /v0/search/persons`（`filter.career`）。

⚠️ 无权限时 `nsfw` 被忽略而不是报错 → **本地二次过滤**。
⚠️ 规范里 `type`/`tag`/`rating` 等字段的描述前后不一致（`meta_tags` 才是实际生效的标签过滤键），实现时以实测为准并做容错。

### 3.6 日历

```
GET /calendar
→ { calendar: [ { weekday: {en,zh,ja,id}, items: LegacySubject[] }, ... ] }
```

`LegacySubject`：`id, url, type, name, name_cn, summary, air_date, air_weekday, images, eps, eps_count, rating{...}, rank, collection{...}`

### 3.7 目录（本期不做）

`/v0/indices`、`/v0/indices/{id}`、`/subjects`、`/collect`。⚠️ 无删除接口。

### 3.8 修订（可选）

`/v0/revisions/subjects/{id}`、`/episodes/{id}`、`/characters/{id}`、`/persons/{id}`。

---

## 4. 枚举

| 枚举 | 值 |
|---|---|
| `SubjectType` | 1 书籍 / 2 动画 / 3 音乐 / 4 游戏 / 6 三次元（**没有 5**） |
| `SubjectBookCategory` | 0 其他 / 1001 漫画 / 1002 小说 / 1003 画集 |
| `SubjectCollectionType` | 1 想看 / 2 看过 / 3 在看 / 4 搁置 / 5 抛弃 |
| `EpisodeCollectionType` | 0 未收藏 / 1 想看 / 2 看过 / 3 抛弃 |
| `EpType` | 0 本篇 / 1 SP / 2 OP / 3 ED / 4 预告 / 5 MAD / 6 其他 |
| `PersonType` | 1 个人 / 2 公司 / 3 组合 |
| `PersonCareer` | producer / mangaka / artist / seiyu / writer / illustrator / actor |

---

## 5. 请求策略

- **UA**：`dsh-bangumi-account/<version> (https://github.com/<owner>/dsh-bangumi-account)`，可配置。
- **节流**：默认 3 req/s，并发 ≤ 2；同步时 2 路分桶。
- **重试**：仅对 429 / 5xx / 网络错误，最多 2 次，退避 250ms → 1s，尊重 `Retry-After`。
- **缓存**：subject 详情 7 天；搜索 10 分钟（内存）；日历 1 小时；收藏由本地同步管。
- **分页**：收藏 `limit=50`；章节 `limit=100`（上限 200）。
- **超时**：连接 8s / 总 20s；工具总预算 30s，超时返回 `TIMEOUT`。

## 6. 错误映射（→ 工具返回的 `code`）

| HTTP / 情况 | code | 给用户的说法 |
|---|---|---|
| 401 | `UNAUTHORIZED` | 令牌无效或已过期，请重新登录 |
| 403 | `FORBIDDEN` | 缺少写权限（`write:collection`）或被限制 |
| 404（收藏语境） | `NOT_FOUND_OR_PRIVATE` | 没收藏过，或这是私有收藏 |
| 404（条目语境） | `NOT_FOUND` | 没有这个条目，要不要换关键词 |
| 429 | `RATE_LIMITED` | 请求太频繁，稍后再试 |
| 5xx | `UPSTREAM` | Bangumi 服务端异常 |
| 无 token | `NOT_SIGNED_IN` | 主人还没登录 |
| 网络 | `NETWORK` | 连不上 api.bgm.tv（检查网络/代理） |
| 超时 | `TIMEOUT` | 请求超时 |
| 缓存为空 | `NOT_SYNCED` | 还没同步过，请到设置页同步 |
