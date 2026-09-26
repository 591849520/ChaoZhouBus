# 工程日志与证据账本契约（logs/）

> 本目录是 `ChaoZhouBus`（潮州同乡会大巴智能选座购票小程序系统）的本地工程记忆和证据账本。
> 依据 [AGENTS.md](../AGENTS.md) 与 [00-coding-agent-first-law.yaml](../00-coding-agent-first-law.yaml) 建立。

## 一、目录结构与职责

- `logs/README.md`：日志契约、状态词、隐私边界、更新顺序和回退规则。
- `logs/Scope/current.md`：当前任务的 Intent、Boundary、Done Criteria、允许文件、非目标、风险和验证要求。
- `logs/Standards/current.md`：实施约束、架构边界、质量门禁及禁止的无关改动。
- `logs/State/current.md`：基线状态、工作区状态、已完成切片、验证结果、阻塞和回退点。
- `logs/Links/current.md`：需求/决策、文件、命令、测试、审查、提交、发布和回退引用。
- `logs/Todo/current.md`：有效 TODO、人工确认、开放风险、负责人和关闭条件的唯一事实源。
- `logs/done/`：已完成任务的只读归档（命名：`YYYY-MM-DD-<task-id>-<slug>.md`）。
- `logs/implementation-log.md`：只追加的历史记录；不得重写旧记录来掩盖失败或改变历史。

## 二、决策状态词定义

- `需用户决定`：存在影响目标、范围、架构、风险或成本的真实取舍，等待用户拍板。
- `需补充信息`：无法从仓库恢复的外部必要输入（如商户号配置、业务规则细节）。
- `用户已决定`：用户已明确做出选择，形成会话与仓库决策账本。
- `Agent 暂定（可撤销）`：低风险、可逆的实现细节，由 Agent 默认推进并显式披露。

## 三、隐私与安全边界

- 严禁记录真实数据库连接串密码、微信支付商户私钥（`apiclient_key.pem`）、APIv3 密钥、小程序 `AppSecret`、用户真实身份证/手机号等个人敏感信息。

## 四、更新顺序与回退规则

1. **工作前**：维护 `Scope/current.md` 与 `Standards/current.md`。
2. **每个切片或阻塞后**：维护 `State/current.md` 与 `Todo/current.md`。
3. **交付前**：维护 `Links/current.md` 并追加 `implementation-log.md`。
4. **回退规则**：验证失败时先记录失败，再记录修复和复测；回退只能触及当前证据链明确列出的文件，不得覆盖无关工作区改动。
