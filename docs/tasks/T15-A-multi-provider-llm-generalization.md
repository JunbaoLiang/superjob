# T15-A — 多 Provider LLM 配置与适配层

## 目标

让本地版和云端 API 都通过同一组通用配置选择 LLM Provider 与模型，同时支持 Anthropic 与 OpenAI；不调用真实模型、不自动部署。

## 本任务的最终配置契约

```env
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=...
```

或：

```env
LLM_PROVIDER=openai
LLM_MODEL=<OpenAI model ID>
OPENAI_API_KEY=...
```

`LLM_PROVIDER` 必须为 `anthropic` 或 `openai`。模型名必须属于所选 Provider。密钥仍按 Provider 分开保存，绝不进入 Git。

## 范围

- 把本地和云端的 Anthropic 专用调用模块替换为 provider-neutral LLM 模块。
- 为 Anthropic Messages API 和 OpenAI Responses API 各实现一个 adapter。
- 保留调用方的 `ask`、`askJSON`、用量统计接口，避免改变职位数据与工作流。
- 使用 mock client 测试路由、请求体、响应文本、用量与配置错误。
- 更新 `.env.example`、Render Blueprint、README 和云端部署指南。

## 明确不做

- 不保留 `ANTHROPIC_MODEL` 的运行时兼容回退。
- 不访问、不创建或不展示任何 API key。
- 不进行真实 LLM 请求、不产生模型费用。
- 不 push、不部署、不修改 Render 环境变量；用户在验收后自行完成变量切换。
- 不迁移岗位、档案或历史材料。

## 验收

1. 本地和云端均不再读取 `ANTHROPIC_MODEL`。
2. Anthropic 与 OpenAI 的 mock 测试均证明使用正确 API 请求结构。
3. 缺失/非法 provider、缺失 model、缺失对应 key 均返回清晰错误。
4. 根目录与云端的测试、语法检查通过，且不调用真实外部 API。
5. 文档列出 Render 的精确变量替换步骤。
