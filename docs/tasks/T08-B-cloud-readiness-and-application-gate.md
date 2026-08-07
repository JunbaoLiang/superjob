# T08-B — 云端材料就绪状态与投递拦截

## 目标

让 Neon/Render 云端工作流遵守与本地相同的质量规则：材料质量和 application status 分离；没有明确 `ready` 确认或带理由 override 的岗位，不能被标为 `applied`。

## 已发现的云端缺口

- `jobs` 表目前没有 `record_policy` 或 `material_readiness` 列；仅有的 `CREATE TABLE IF NOT EXISTS` 不会向已经存在的表追加列。
- 云端 `setStatus`、`POST /api/status` 和云端网页看板可直接设置 `applied`，没有事实核查、页数、材料版本或人工确认检查。
- 云端抓取与生成没有记录 `active-2027` 材料版本，也不能拒绝冻结历史岗位的重生成。
- 真实 Neon 内容不得输出到日志、Git、任务结果或对话；云端 backfill 必须只报告汇总数。

## 数据模型

在 `jobs` 表新增独立 JSONB 列，避免污染原始 JD `job` JSON：

```sql
record_policy       JSONB NULL,
material_readiness  JSONB NULL
```

两列使用与本地相同的对象契约：

- `record_policy`：`record_type`、`frozen`、`frozen_reason`、`material_profile_version`；
- `material_readiness`：`state`、`assessment`、`confirmation`。

已有 `applied`/`rejected`（以及已经标为 historical 的记录）保持原样，不回填、不重写材料。只为合格的 `new`/`to-apply` 活跃记录新增元数据。

## T08-B1 — 离线实现与测试

1. 增加幂等 schema 升级：`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ...`；不在 Render 启动时执行 backfill。
2. 增加云端版本的纯 readiness 评估、标准确认、带理由 override 和 `applied` transition guard；契约必须与本地行为等价。
3. 更新云端 data access：只允许白名单字段写入；`setStatus(..., "applied")` 在同一个存储层校验 readiness，供 API/队列/未来入口共用。
4. 更新云端抓取、生成和任务队列：
   - 新抓取的岗位建立 active、`unknown` 材料版本的 record policy；
   - 只允许 active/unfrozen 岗位生成材料；新生成后写 `active-2027` 与新的 `draft`/`needs-review` 评估，清除旧确认；
   - `applied`/`rejected` 不会被 backfill 或自动重生成。
5. 增加认证 API：读取 readiness；`POST /api/readiness/confirm` 与 `POST /api/readiness/override`；返回可行动错误，不回显简历/JD 或模型原文。
6. 更新 `cloud/web`：显示 readiness badge、确认/override 操作和被拒绝状态转换的错误提示。
7. 增加 offline fake-`pg`/fixture 测试，覆盖 schema 幂等 SQL、backfill 计划、历史保留、空 override、生成重置确认、直接 `applied` 拒绝、API 鉴权及 UI 请求路径。

## T08-B2 — 部署前 schema 与 dry-run（需单独授权）

1. 先运行发布检查和密钥扫描；只提交/push 审核过的公开代码。
2. 等 Render 部署新代码；仅验证 `/health` 与未鉴权请求仍为 401。
3. 在仓库根目录先执行一次 `npm install`（该安装包含回填脚本所需的 `pg`），再使用用户自己持有的 `DATABASE_URL` 执行只读 `cloud/migrate/readiness-backfill.js --dry-run`，或在 Neon SQL Console 执行等价只读统计。不得把连接串复制进 Git、聊天或命令输出。
4. 输出仅包括：活跃将新增数、各 readiness 状态数、已有 metadata 数、历史保留数、异常数；不输出岗位名、JD、简历、求职信或 raw text。

## T08-B3 — 云端 active-only backfill（需 dry-run 后再次确认）

1. 在相同版本的 backfill 工具中使用显式 `--apply`，事务内仅写 `record_policy` 和 `material_readiness` 两列。
2. 立即执行第二次 dry-run，预期零新增。
3. 复核 application status 总数、历史材料/文件计数不变，以及 API 对非 ready `→ applied` 返回 400。
4. 不删除 Neon 数据、不迁移后删除本地副本、不自动提交真实申请。

## 非范围

- 不迁移本地岗位到云端，不把两套数据合并，也不删除任何本地数据。
- 不调用 LLM、不重新生成真实材料、不自动投递或发送外联。
- 不创建付费资源，不修改 Render/Neon 凭据，不自动进入用户账户。
- 不 commit、push、部署或执行 Neon SQL，除非对应分段明确获得授权。

## 验收

T08-B1：

```bash
npm run test:all
node --check cloud/server/src/db.js
node --check cloud/server/src/jobs.js
node --check cloud/server/src/pipeline.js
node --check cloud/server/src/index.js
git diff --check
```

T08-B2/B3：

1. 云端 health 正常、无 token 的 `/api/jobs` 仍为 401。
2. 云端未 ready 记录无法经 API 或网页标 `applied`；确认/override 有可追溯记录。
3. backfill 仅影响 active records，重复运行是 no-op，历史状态/材料/文件计数保持不变。
4. 本地服务与本地数据不受云端操作影响。

## 下一步授权

`授权执行 T08-B1`：只修改云端源代码和离线 fake-DB/UI 测试；不连接 Neon、调用模型、改真实云端数据、commit/push 或部署。
