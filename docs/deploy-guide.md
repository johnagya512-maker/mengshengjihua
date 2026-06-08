# 闷声计划 — 部署操作手册

> 面向首次上线。代码侧已就绪，本手册覆盖**微信云开发控制台 + 公众平台**的全部手工配置。按顺序勾选执行即可。

前置：已安装微信开发者工具，已用项目 AppID 打开本项目，已开通「云开发」环境。

---

## 0. 部署前自检（本地）

- [ ] 确认 `miniprogram/utils/request.ts` 里 `USE_MOCK = false`（上线必须，true 会走本地假数据）
- [ ] 本地跑一遍排期测试：`node test/scheduler.test.js`，应显示 `18 passed, 0 failed`
- [ ] 开发者工具右上角已选中正确的云开发环境（测试环境 vs 正式环境别搞混）

---

## 1. 部署 12 个云函数

位置：开发者工具左侧 `cloudfunctions/` 目录，**右键每个函数文件夹 → 上传并部署：云端安装依赖**。

逐个部署（共 12 个，勿漏 `task_defer`，它是本次新增）：

- [ ] auth_login
- [ ] profile_init
- [ ] profile_learn
- [ ] project_create
- [ ] project_delete
- [ ] project_list
- [ ] schedule_compute
- [ ] task_complete
- [ ] task_defer
- [ ] task_delete
- [ ] task_parse
- [ ] task_save

> 注意：`cloudfunctions/common/` 不是云函数（是未启用的共享模块草稿），**不要部署**。
> 每个函数都依赖 `wx-server-sdk`，务必选「云端安装依赖」而非「仅上传文件」。

---

## 2. 创建 6 个数据库集合

位置：云开发控制台 → 数据库 → 创建集合。逐个新建（名称必须完全一致）：

- [ ] users
- [ ] profiles
- [ ] projects
- [ ] tasks
- [ ] skip_logs
- [ ] daily_capacity

> 集合不必预设字段，云函数首次写入时自动建字段。漏建集合会导致对应云函数报「集合不存在」。

---

## 3. 配置安全规则「仅创建者可读写」

位置：每个集合 → 权限设置 → 自定义安全规则。**6 个集合统一粘贴**以下规则：

```json
{
  "read": "doc._openid == auth.openid",
  "write": "doc._openid == auth.openid"
}
```

- [ ] users
- [ ] profiles
- [ ] projects
- [ ] tasks
- [ ] skip_logs
- [ ] daily_capacity

> 这一步是隐私底线，漏配会让数据可被跨用户读写。务必 6 个都配。
> 说明：本项目所有读写都走云函数（admin 权限会绕过安全规则），跨用户隔离当前由云函数内的 `_openid` 过滤保证；安全规则是「将来开放端侧直连时」的兜底，仍建议现在就配齐。

---

## 4. 配置环境变量（两个密钥）

位置：云开发控制台 → 云函数 → 选中函数 → 配置 → 环境变量。

### 4.1 task_parse 配 `DEEPSEEK_API_KEY`（必须，否则 AI 解析全挂）

- [ ] 到 DeepSeek 开放平台申请 API Key
- [ ] 仅给 **task_parse** 这一个函数加环境变量：
  - 键：`DEEPSEEK_API_KEY`
  - 值：`sk-xxxxxxxx`（你的真实 key）
- [ ] 保存后**重新部署 task_parse**（环境变量改动需重新部署生效）

> 漏配会导致「说一句话→AI 拆解」主路径直接返回 500，产品核心循环不可用。
> 其余 11 个函数都不读这个变量，不用配。

### 4.2 auth_login 配 `TOKEN_SECRET`（HMAC 签名密钥）

- [ ] 生成一个随机长字符串（如 32+ 位随机串）
- [ ] 给 **auth_login** 加环境变量：
  - 键：`TOKEN_SECRET`
  - 值：你的随机密钥（**切勿用代码里的默认值** `mengsheng-dev-secret-change-me`）
- [ ] 保存后**重新部署 auth_login**

> 这是登录 token 的签名密钥。用默认值等于没签名，任何人可伪造 token。

---

## 5. 创建推荐索引

位置：云开发控制台 → 数据库 → 选中集合 → 索引管理 → 新建索引。

- [ ] **tasks**：组合索引 `_openid(升序) + status(升序) + scheduled_time(升序)`，非唯一
- [ ] **projects**：组合索引 `_openid(升序) + created_at(升序)`，非唯一
- [ ] **daily_capacity**：组合索引 `_openid(升序) + date(升序)`，**勾选「唯一索引」**

> daily_capacity 必须设唯一索引：schedule_compute 是「先查后插」，并发下不设唯一索引会产生重复的当日容量行。

---

## 6. 微信公众平台合规配置

位置：[mp.weixin.qq.com](https://mp.weixin.qq.com) → 你的小程序后台。

- [ ] **填写《用户隐私保护指引》**：设置 → 服务内容声明 → 用户隐私保护指引。
      声明收集项：微信 openid（登录标识）、用户主动输入的任务内容。
      不填会导致 `wx.openPrivacyContract` 调起失败、登录页弹「请配置隐私协议」。
- [ ] 确认登录页隐私链接可点开（代码已接 `wx.openPrivacyContract`，见 guide 页）

---

## 7. 语音插件授权（可选，不阻断上线）

代码用 `requirePlugin('WechatSI')` 调同声传译插件做语音转文字。要让语音真正可用，**两步都做**：

- [ ] 公众平台 → 设置 → 第三方设置 → 插件管理 → 添加「微信同声传译」插件并授权
- [ ] 在 `miniprogram/app.json` 顶层补 `plugins` 声明（当前缺，缺则语音永久降级）：

```json
"plugins": {
  "WechatSI": {
    "version": "latest",
    "provider": "wx069ba97219f66d99"
  }
}
```

> 不做这两步不影响上线——语音会优雅降级为「未开启」，文字输入照常可用。
> 若决定 MVP 不上语音，可跳过本节。

---

## 8. 上线冒烟测试（真机）

用真机预览，跑通一遍核心循环：

- [ ] 微信登录 → 进主界面（首登应静默建好默认 Profile）
- [ ] 输入一句话 → AI 解析出确认卡片 → 确认 → 任务进队列（验证 DEEPSEEK_API_KEY 生效）
- [ ] 点开始 → 专注计时 → 完成，回主界面看进度胶囊变化
- [ ] 加任务到容量饱和 → 弹「移到明天」→ 确认 → 任务从今日列表移除（验证 task_defer 生效）
- [ ] 进项目页 → 看到项目圆环 + 任务分组
- [ ] 跳过一个任务并选归因 → 不报错

---

## 9. 常见问题速查

| 现象 | 多半是 | 对应步骤 |
|------|--------|----------|
| 登录后白屏 / 报集合不存在 | 漏建集合 | §2 |
| AI 解析一直转圈最后报错 | DEEPSEEK_API_KEY 没配或没重新部署 | §4.1 |
| 「移到明天」点了没反应 | task_defer 没部署 | §1 |
| 数据能看到别人的 | 安全规则没配 | §3 |
| 语音按钮提示「未开启」 | 插件没授权 / app.json 缺 plugins | §7 |
| 当日容量出现重复行 | daily_capacity 漏设唯一索引 | §5 |

---

## 附：本次需要的密钥清单（提前备好）

| 密钥 | 用途 | 配在哪 |
|------|------|--------|
| DEEPSEEK_API_KEY | AI 任务解析 | task_parse 环境变量 |
| TOKEN_SECRET | 登录 token HMAC 签名 | auth_login 环境变量 |



