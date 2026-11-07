window.__ModuleLoader__.load({
  id: 'dsh-bangumi-account',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-bangumi-account'

    const zh = {
      nav: 'Bangumi',
      status_signed: '已连接',
      status_unsigned: '未登录',
      last_sync: '上次同步',
      never: '从未同步',
      items: '部收藏',
      method_pat: '访问令牌',
      logout: '退出登录',
      logging_out: '正在退出…',
      login_title: '登录 Bangumi',
      login_hint: '在 Bangumi 生成个人访问令牌后粘贴到这里。令牌只保存在本机凭据库，不写进配置文件，也不会出现在对话里。',
      token_label: '访问令牌',
      token_placeholder: '粘贴 access token',
      token_link: '去生成令牌',
      verify: '验证并保存',
      verifying: '验证中…',
      sync_title: '同步',
      sync_now: '立即同步',
      syncing: '同步中',
      clear_cache: '清除缓存',
      sync_done: '同步完成',
      taste_title: '口味档案',
      taste_empty: '还没有档案，先同步一次。',
      taste_rebuild: '重新生成档案',
      taste_preview: '预览档案文本',
      chars: '字',
      ability_title: '能力与隐私',
      allow_read: '允许大肥鱼读取我的收藏',
      allow_write: '允许大肥鱼修改我的收藏',
      allow_write_hint: '开启后，鱼可以在对话里直接改你的收藏状态、评分和进度。Bangumi 不支持细分权限，开了就是全部写权限。',
      include_nsfw: '包含 NSFW 作品',
      include_private: '包含私有收藏',
      include_comments: '在档案里包含我的短评',
      advanced: '高级',
      api_base: 'API 地址',
      user_agent: 'User-Agent',
      proxy: '代理',
      proxy_hint: '留空则自动：环境变量 → 系统代理 → 直连；填 direct 可强制直连',
      sync_interval: '自动同步间隔（小时）',
      diagnose: '测试连接',
      diagnosing: '测试中…',
      save: '保存',
      saved: '已保存',
      export: '导出我的数据',
      delete_all: '删除全部本地数据',
      unknown: '未知错误',
      type_anime: '动画',
      type_book: '书籍',
      type_music: '音乐',
      type_game: '游戏',
      type_real: '三次元',
      time_now: '刚刚',
      time_min: '{n} 分钟前',
      time_hour: '{n} 小时前',
      token_expired: '令牌已过期，请重新登录',
      sync_failed: '同步失败',
      sync_phase_listing: '读取收藏列表',
      sync_phase_profiling: '生成档案',
      sync_phase_idle: '空闲',
    }
    const en = {
      nav: 'Bangumi',
      status_signed: 'Connected',
      status_unsigned: 'Not signed in',
      last_sync: 'Last sync',
      never: 'Never',
      items: 'collections',
      method_pat: 'Access token',
      logout: 'Sign out',
      logging_out: 'Signing out…',
      login_title: 'Sign in to Bangumi',
      login_hint: 'Create a personal access token on Bangumi and paste it here. It stays in the local credential store.',
      token_label: 'Access token',
      token_placeholder: 'Paste an access token',
      token_link: 'Create a token',
      verify: 'Verify and save',
      verifying: 'Verifying…',
      sync_title: 'Sync',
      sync_now: 'Sync now',
      syncing: 'Syncing',
      clear_cache: 'Clear cache',
      sync_done: 'Sync finished',
      taste_title: 'Taste profile',
      taste_empty: 'No profile yet — run a sync first.',
      taste_rebuild: 'Rebuild profile',
      taste_preview: 'Preview profile text',
      chars: 'chars',
      ability_title: 'Capabilities and privacy',
      allow_read: 'Let the pet read my collections',
      allow_write: 'Let the pet modify my collections',
      allow_write_hint: 'When enabled, the pet may change your status, rating and progress from a conversation.',
      include_nsfw: 'Include NSFW titles',
      include_private: 'Include private collections',
      include_comments: 'Include my short comments in the profile',
      advanced: 'Advanced',
      api_base: 'API base',
      user_agent: 'User-Agent',
      proxy: 'Proxy',
      proxy_hint: 'Leave empty to auto: environment → system proxy → direct; use "direct" to force a direct connection',
      sync_interval: 'Auto-sync interval (hours)',
      diagnose: 'Test connection',
      diagnosing: 'Testing…',
      save: 'Save',
      saved: 'Saved',
      export: 'Export my data',
      delete_all: 'Delete all local data',
      unknown: 'Unknown error',
      type_anime: 'anime',
      type_book: 'books',
      type_music: 'music',
      type_game: 'games',
      type_real: 'live action',
      time_now: 'just now',
      time_min: '{n} min ago',
      time_hour: '{n} h ago',
      token_expired: 'Token expired — sign in again',
      sync_failed: 'Sync failed',
      sync_phase_listing: 'Reading collections',
      sync_phase_profiling: 'Building profile',
      sync_phase_idle: 'Idle',
    }

    const CSS = `
      .bgm_page{display:flex;flex-direction:column;gap:12px;padding:4px 0 24px;max-width:760px}
      .bgm_card{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);overflow:hidden}
      .bgm_card_head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.12))}
      .bgm_card_title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
      .bgm_body{padding:4px 16px 8px;display:flex;flex-direction:column}
      .bgm_row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0}
      .bgm_row+.bgm_row{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.12))}
      .bgm_col{flex-direction:column;align-items:stretch;gap:8px}
      .bgm_label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);line-height:1.45}
      .bgm_hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
      .bgm_value{font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.45;text-align:right;max-width:60%;word-break:break-all}
      .bgm_input{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));color:var(--dsw-alias-label-primary);outline:none}
      .bgm_input:focus{border-color:var(--dsw-alias-brand-primary,#0f766e)}
      .bgm_actions{display:flex;flex-wrap:wrap;gap:8px;padding:10px 0 6px}
      .bgm_btn{appearance:none;font:inherit;font-size:13px;line-height:1;padding:8px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;background:var(--dsw-alias-brand-primary,#0f766e);color:#fff}
      .bgm_btn:disabled{opacity:.55;cursor:default}
      .bgm_btn_ghost{background:transparent;border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.3));color:var(--dsw-alias-label-secondary)}
      .bgm_btn_danger{background:transparent;border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.3));color:var(--dsw-alias-state-error-primary,#ef4444)}
      .bgm_badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));color:var(--dsw-alias-label-secondary)}
      .bgm_dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
      .bgm_dot_on{background:var(--dsw-alias-state-success-primary,#16a34a)}
      .bgm_avatar{width:36px;height:36px;border-radius:50%;object-fit:cover;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15));flex:none}
      .bgm_switch{display:flex;align-items:center;gap:10px;cursor:pointer;flex:none}
      .bgm_switch input{position:absolute;opacity:0;width:0;height:0}
      .bgm_track{width:34px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3));position:relative;transition:background .15s;flex:none}
      .bgm_track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
      .bgm_switch input:checked+.bgm_track{background:var(--dsw-alias-brand-primary,#0f766e)}
      .bgm_switch input:checked+.bgm_track::after{transform:translateX(14px)}
      .bgm_err{font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#ef4444);padding:2px 0}
      .bgm_ok{font-size:12px;line-height:1.5;color:var(--dsw-alias-state-success-primary,#16a34a);padding:2px 0}
      .bgm_chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 6px}
      .bgm_chip{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));color:var(--dsw-alias-label-secondary)}
      .bgm_chip_bad{color:var(--dsw-alias-state-error-primary,#ef4444)}
      .bgm_pre{white-space:pre-wrap;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));border-radius:8px;padding:10px;margin:6px 0}
      .bgm_progress{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.2));overflow:hidden}
      .bgm_progress span{display:block;height:100%;background:var(--dsw-alias-brand-primary,#0f766e);transition:width .2s}
    `

    async function apiState() {
      const response = await fetch('/dsh-bangumi/state', { cache: 'no-store' })
      if (!response.ok) throw new Error('state ' + response.status)
      return response.json()
    }

    async function apiPost(action, body) {
      const response = await fetch('/dsh-bangumi' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!payload.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : 'request failed')
      return payload
    }

    function formatTime(value, t) {
      if (!value) return null
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return null
      const diff = Date.now() - date.getTime()
      const withCount = (key, count) => String(t(key)).replace('{n}', count)
      if (diff < 60000) return t('time_now')
      if (diff < 3600000) return withCount('time_min', Math.floor(diff / 60000))
      if (diff < 86400000) return withCount('time_hour', Math.floor(diff / 3600000))
      return date.toLocaleString()
    }

    function Toggle(props) {
      return h('label', { className: 'bgm_switch', title: props.title },
        h('input', {
          type: 'checkbox', checked: Boolean(props.checked), disabled: props.disabled,
          onChange: (event) => props.onChange(event.target.checked),
        }),
        h('span', { className: 'bgm_track' }))
    }

    function Card(props) {
      return h('section', { className: 'bgm_card' },
        h('div', { className: 'bgm_card_head' },
          h('span', { className: 'bgm_card_title' }, props.title),
          props.extra || null),
        h('div', { className: 'bgm_body' }, props.children))
    }

    function Row(props) {
      return h('div', { className: 'bgm_row' + (props.stack ? ' bgm_col' : '') },
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'bgm_label' }, props.label),
          props.hint ? h('div', { className: 'bgm_hint' }, props.hint) : null),
        props.children)
    }

    function BangumiSection(ctx) {
      const t = ctx && ctx.t ? ctx.t : ((key) => (zh[key] || key))
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [token, setToken] = React.useState('')
      const [showPreview, setShowPreview] = React.useState(false)
      const [draft, setDraft] = React.useState(null)

      const refresh = React.useCallback(async () => {
        try {
          const next = await apiState()
          setState(next)
          setError('')
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }, [])

      React.useEffect(() => { void refresh() }, [refresh])

      const syncingNow = state && state.sync && state.sync.running
      React.useEffect(() => {
        if (!syncingNow) return undefined
        const timer = setInterval(() => { void refresh() }, 1500)
        return () => clearInterval(timer)
      }, [syncingNow, refresh])

      React.useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(''), 2200)
        return () => clearTimeout(timer)
      }, [notice])

      React.useEffect(() => {
        if (state && !draft) {
          setDraft({
            includeNsfw: state.config.includeNsfw,
            includePrivate: state.config.includePrivate,
            includeComments: state.config.includeComments,
            allowWrite: state.config.allowWrite,
            apiBase: state.config.apiBase,
            userAgent: state.config.userAgent,
            proxy: state.config.proxy,
            syncIntervalHours: state.config.syncIntervalHours,
          })
        }
      }, [state, draft])

      async function run(name, task) {
        setBusy(name)
        setError('')
        try {
          await task()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setBusy('')
          await refresh()
        }
      }

      const login = () => run('login', async () => {
        if (!token.trim()) throw new Error('请先粘贴令牌')
        await apiPost('/login', { token: token.trim() })
        setToken('')
        setNotice('登录成功')
      })

      const sync = () => run('sync', async () => {
        await apiPost('/sync')
        setNotice('开始同步')
      })

      const save = (patch) => run('save', async () => {
        await apiPost('/settings', patch)
        // Writing config reloads the plugin, so let it come back before re-reading state.
        setDraft(null)
        await new Promise((resolve) => setTimeout(resolve, 1500))
      })

      const signedIn = Boolean(state && state.signedIn)
      const counts = (state && state.counts) || null
      const total = counts ? counts.total : 0
      const progress = state && state.sync && state.sync.total
        ? Math.min(100, Math.round((state.sync.done / state.sync.total) * 100))
        : 0

      return h('div', { className: 'bgm_page' },
        h('style', null, CSS),

        h(Card, {
          title: 'Bangumi',
          extra: h('span', { className: 'bgm_badge' },
            h('span', { className: 'bgm_dot' + (signedIn ? ' bgm_dot_on' : '') }),
            signedIn ? t('status_signed') : t('status_unsigned')),
        },
        signedIn
          ? h(React.Fragment, null,
            h(Row, { label: (state.nickname || state.username || '') + (state.username ? `  @${state.username}` : '') },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                state.avatar ? h('img', { className: 'bgm_avatar', src: state.avatar, alt: '', onError: (event) => { event.currentTarget.style.display = 'none' } }) : null,
                h('span', { className: 'bgm_value' }, t('method_pat')))),
            h(Row, { label: t('last_sync') },
              h('span', { className: 'bgm_value' },
                (formatTime(state.lastSyncAt, t) || t('never')) + (total ? ` · ${total} ${t('items')}` : ''))),
            state.expired ? h('div', { className: 'bgm_err' }, t('token_expired')) : null,
            h('div', { className: 'bgm_actions' },
              h('button', { className: 'bgm_btn', disabled: busy === 'sync' || Boolean(syncingNow), onClick: sync },
                syncingNow ? t('syncing') + (state.sync.total ? ` ${state.sync.done}/${state.sync.total}` : '') : t('sync_now')),
              h('button', { className: 'bgm_btn bgm_btn_ghost', disabled: busy === 'logout', onClick: () => run('logout', () => apiPost('/logout')) }, t('logout'))),
            syncingNow
              ? h('div', { className: 'bgm_progress' }, h('span', { style: { width: progress + '%' } }))
              : null,
            state.sync && state.sync.error
              ? h('div', { className: 'bgm_err' }, `${t('sync_failed')}: ${state.sync.error.message}`)
              : null)
          : h('div', { className: 'bgm_body' },
            h('div', { className: 'bgm_hint', style: { padding: '4px 0 10px' } }, t('login_hint')),
            h('div', { style: { display: 'flex', gap: 8, paddingBottom: 10, flexWrap: 'wrap' } },
              h('input', {
                className: 'bgm_input', type: 'password', autoComplete: 'off', placeholder: t('token_placeholder'),
                value: token, onChange: (event) => setToken(event.target.value),
                style: { flex: '1 1 240px' },
              }),
              h('button', { className: 'bgm_btn', disabled: busy === 'login', onClick: login },
                busy === 'login' ? t('verifying') : t('verify'))),
            h('a', {
              className: 'bgm_hint', href: 'https://next.bgm.tv/demo/access-token', target: '_blank', rel: 'noreferrer',
              style: { color: 'var(--dsw-alias-brand-primary,#0f766e)', textDecoration: 'underline', paddingBottom: 8 },
            }, t('token_link')))),

        error ? h('div', { className: 'bgm_err' }, error) : null,
        notice ? h('div', { className: 'bgm_ok' }, notice) : null,

        signedIn ? h(Card, {
          title: t('taste_title'),
          extra: state.profileVersion ? h('span', { className: 'bgm_hint' }, state.profileVersion) : null,
        },
        state.profileHasData
          ? h(React.Fragment, null,
            h('div', { className: 'bgm_hint', style: { padding: '10px 0 6px' } }, state.profileBrief),
            state.profileBrief
              ? h('div', { className: 'bgm_chips' },
                (state.counts && state.counts.byType
                  ? Object.entries(state.counts.byType).filter(([, value]) => value > 0).map(([key, value]) =>
                    h('span', { className: 'bgm_chip', key }, `${t('type_' + key)} ${value}`))
                  : []))
              : null,
            h('div', { className: 'bgm_actions' },
              h('button', { className: 'bgm_btn bgm_btn_ghost', disabled: busy === 'rebuild', onClick: () => run('rebuild', () => apiPost('/rebuild')) }, t('taste_rebuild')),
              h('button', {
                className: 'bgm_btn bgm_btn_ghost',
                onClick: () => setShowPreview((value) => !value),
              }, t('taste_preview'))),
            showPreview ? h('div', { className: 'bgm_pre' }, state.profileBrief || t('taste_empty')) : null)
          : h('div', { className: 'bgm_hint', style: { padding: '10px 0' } }, t('taste_empty'))) : null,

        h(Card, { title: t('ability_title') },
          h(Row, { label: t('include_nsfw'), hint: 'NSFW 作品默认不进档案' },
            h(Toggle, { checked: draft ? draft.includeNsfw : false, onChange: (value) => setDraft({ ...draft, includeNsfw: value }) })),
          h(Row, { label: t('include_private'), hint: '私有收藏默认不进档案' },
            h(Toggle, { checked: draft ? draft.includePrivate : false, onChange: (value) => setDraft({ ...draft, includePrivate: value }) })),
          h(Row, { label: t('include_comments'), hint: '短评会作为「他写过的话」进入档案' },
            h(Toggle, { checked: draft ? draft.includeComments : false, onChange: (value) => setDraft({ ...draft, includeComments: value }) })),
          h(Row, { label: t('allow_write'), hint: t('allow_write_hint') },
            h(Toggle, {
              checked: draft ? draft.allowWrite : false,
              onChange: (value) => {
                if (value && typeof window !== 'undefined' && typeof window.confirm === 'function') {
                  const ok = window.confirm(t('allow_write_hint'))
                  if (!ok) return
                }
                setDraft({ ...draft, allowWrite: value })
              },
            })),
          h('div', { className: 'bgm_actions' },
            h('button', {
              className: 'bgm_btn', disabled: busy === 'save' || !draft,
              onClick: () => save({
                includeNsfw: draft.includeNsfw,
                includePrivate: draft.includePrivate,
                includeComments: draft.includeComments,
                allowWrite: draft.allowWrite,
              }),
            }, t('save')))),

        h('details', { className: 'bgm_card', style: { padding: '0 16px' } },
          h('summary', { className: 'bgm_card_title', style: { padding: '12px 0', cursor: 'pointer' } }, t('advanced')),
          draft ? h('div', { className: 'bgm_body', style: { padding: '0 0 8px' } },
            h(Row, { label: t('api_base') },
              h('input', { className: 'bgm_input', style: { maxWidth: 260 }, value: draft.apiBase, onChange: (event) => setDraft({ ...draft, apiBase: event.target.value }) })),
            h(Row, { label: t('proxy'), hint: t('proxy_hint') },
              h('input', { className: 'bgm_input', style: { maxWidth: 260 }, value: draft.proxy, placeholder: 'http://127.0.0.1:7897', onChange: (event) => setDraft({ ...draft, proxy: event.target.value }) })),
            h(Row, { label: t('user_agent') },
              h('input', { className: 'bgm_input', style: { maxWidth: 260 }, value: draft.userAgent, onChange: (event) => setDraft({ ...draft, userAgent: event.target.value }) })),
            h(Row, { label: t('sync_interval') },
              h('input', {
                className: 'bgm_input', type: 'number', min: 0, max: 720, style: { maxWidth: 100 },
                value: draft.syncIntervalHours,
                onChange: (event) => setDraft({ ...draft, syncIntervalHours: Number(event.target.value) }),
              })),
            h('div', { className: 'bgm_hint', style: { paddingTop: 8 } },
              `网络：${state && state.proxy ? (state.proxy.proxy || '直连') + '（' + state.proxy.source + '）' : '未探测'}`),
            h('div', { className: 'bgm_actions' },
              h('button', { className: 'bgm_btn', disabled: busy === 'save', onClick: () => save({
                apiBase: draft.apiBase, proxy: draft.proxy, userAgent: draft.userAgent, syncIntervalHours: draft.syncIntervalHours,
              }) }, t('save')),
              h('button', { className: 'bgm_btn bgm_btn_ghost', disabled: busy === 'diag', onClick: () => run('diag', async () => {
                const result = await apiPost('/diagnose')
                if (result.publicRead) {
                  setNotice(`连接正常 ${result.latencyMs}ms · 代理 ${result.proxy && result.proxy.proxy ? result.proxy.proxy : '直连'}`)
                } else {
                  const reason = result.error ? `${result.error.message}${result.error.hint ? `（${result.error.hint}）` : ''}` : '未知原因'
                  throw new Error(reason)
                }
              }) }, busy === 'diag' ? t('diagnosing') : t('diagnose')),
              h('button', {
                className: 'bgm_btn bgm_btn_ghost',
                onClick: () => { window.open('/dsh-bangumi/export', '_blank') },
              }, t('export')),
              h('button', {
                className: 'bgm_btn bgm_btn_danger',
                onClick: () => run('purge', () => apiPost('/purge')),
              }, t('delete_all')))) : null))
    }

    function buildT(ctx) {
      const locale = ctx && ctx.locale
      if (locale && typeof locale.register === 'function') {
        try { locale.register(NS, { zh, en }) } catch { /* keep the local dictionary */ }
      }
      if (locale && typeof locale.bind === 'function') {
        try {
          const bound = locale.bind(NS)
          return (key) => {
            try { return bound(key) || zh[key] || key } catch { return zh[key] || key }
          }
        } catch { /* fall back */ }
      }
      const preferred = typeof navigator !== 'undefined' && /^en/i.test(navigator.language || '') ? en : zh
      return (key) => preferred[key] || zh[key] || key
    }

    return {
      // `locale` must be injected: reading an uninjected service through the
      // cordis context proxy throws ("cannot get property ... without inject"),
      // which would fail the whole web boot. `slots` alone is not enough.
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = buildT(ctx)
        const Section = () => h(BangumiSection, { t })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'bangumi',
          order: 1200,
          label: () => t('nav'),
          locale: NS,
        }, Section))
      },
    }
  },
})
