# 云数据库集合设计 — 闷声计划

> 所有集合按 `openid` / `user_id` 物理隔离。安全规则统一为「仅本人可读写」。

## 安全规则（每个集合通用）
```json
{
  "read": "doc._openid == auth.openid",
  "write": "doc._openid == auth.openid"
}
```
> 写入时云函数侧以 openid 注入 `_openid` 字段；查询自动过滤。

---

## users
| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | string | 微信 openid（主键，自动） |
| user_id | string | 系统内部 ID |
| created_at | number | 注册时间戳 |
| last_login | number | 最近登录 |

## profiles
| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | string | 隔离键 |
| user_id | string | 关联 users |
| peak_hours | array<string> | ["09:00-11:00"] |
| pain_task_types | array<string> | 头疼任务标签 |
| ideal_work_hours | number | 1~12, step 0.5 |
| created_at | number | |

## projects
| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | string | 隔离键 |
| project_id | string | |
| name | string | 1~30 字符 |
| color | string | 系统分配 HEX |
| created_at | number | |

## tasks
| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | string | 隔离键 |
| task_id | string | |
| project_id | string | 关联 projects |
| project_tag | string | 冗余项目名，便于展示 |
| action | string | 1~100 字符 |
| duration | number | 枚举 15..120 |
| vision_statement | string | 1~80 字符 |
| type | string | normal / gap（治愈间隙） |
| status | string | pending / done / skip |
| scheduled_time | string | 排期时间 HH:mm |
| actual_duration | number | 实际耗时 |
| skip_reason | string | 没状态/等待外部/临时取消 |
| is_priority | boolean | P0 紧急 |
| created_at | number | |

## skip_logs（隐形学习数据）
| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | string | 隔离键 |
| task_id | string | |
| skip_reason | string | |
| created_at | number | |

## daily_capacity
| 字段 | 类型 | 说明 |
|------|------|------|
| _openid | string | 隔离键 |
| date | string | YYYY-MM-DD |
| capacity_total | number | 当日总可用分钟 = ideal×60×0.8 |
| capacity_used | number | 已用分钟 |

## 推荐索引
- tasks: `(_openid, status, scheduled_time)`
- projects: `(_openid, created_at)`
- daily_capacity: `(_openid, date)` 唯一
