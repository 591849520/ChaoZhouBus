# Current Scope — 项目规范文档本地化改造与架构初始化

## 1. Intent（目标结果）
1. 初始化 `logs/` 本地工程日志体系（已由用户确认 `D-003 = A`）。
2. 与用户敲定 `ChaoZhouBus`（高校同乡会大巴智能选座购票小程序系统）的技术选型（`D-001`）、目录结构（`D-002`）及规范文档改造方案（`D-004`）。
3. 将从旧项目（Next.js + MongoDB）拷贝而来的 5 份文档（`AGENTS.md`、`CONTRIBUTING.md`、`CODE_REVIEW_GUIDE.md`、`CHANGELOG.md`、`00-coding-agent-first-law.yaml`）修改为适配本项目业务与技术栈的工程规范文档。

## 2. Boundary（边界：不改什么）
- 在 `D-001`、`D-002`、`D-004` 获得用户确认前，不擅自修改现有规范文档或创建业务代码目录。
- 不删除 `00-coding-agent-first-law.yaml` 的核心工程治理原则。

## 3. Done Criteria（完成标准）
- [x] `logs/` 目录及基础契约文件初始化完成。
- [x] 用户确认服务端语言/框架、目录结构及文档改造范围（`D-001=A`, `D-002=A`, `D-003=A`, `D-004=A`）。
- [x] `AGENTS.md`、`CONTRIBUTING.md`、`CODE_REVIEW_GUIDE.md`、`CHANGELOG.md` 完成去旧项目化（移除 MongoDB / Next.js / 旧 GitLab 历史等残留），写入大巴选座小程序对应的轻量化技术栈、目录规范与测试模板。

## 4. 允许变更文件
- `logs/**`
- （待确认后）`AGENTS.md`、`CONTRIBUTING.md`、`CODE_REVIEW_GUIDE.md`、`CHANGELOG.md`、`00-coding-agent-first-law.yaml`
