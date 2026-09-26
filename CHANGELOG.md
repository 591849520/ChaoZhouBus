# Changelog

All notable changes to the **ChaoZhouBus（高校同乡会大巴智能选座购票小程序系统）** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 0.1.0

### Added
- 初始化 `logs/` 本地工程日志与证据账本体系（`Scope`、`Standards`、`State`、`Links`、`Todo`、`implementation-log`）。
- 确立极致轻量化全栈架构：微信原生小程序 (TS) + Node.js (TypeScript + Fastify) + SQLite 3 (`better-sqlite3` WAL 模式) + 同步事务排他锁与 300s 时间戳惰性释放机制。
- 完成项目工程规范文档定制：[AGENTS.md](AGENTS.md)、[CONTRIBUTING.md](CONTRIBUTING.md)、[CODE_REVIEW_GUIDE.md](CODE_REVIEW_GUIDE.md) 与 [00-coding-agent-first-law.yaml](00-coding-agent-first-law.yaml)。
