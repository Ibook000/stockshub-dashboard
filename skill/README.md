# StocksHub API - AI Agent Config

兼容多种 AI Agent 的配置文件。

## Hermes Agent

**文件**: `~/.hermes/skills/stockshub-api/SKILL.md`

```bash
mkdir -p ~/.hermes/skills/stockshub-api
cp skill/stockshub-api.md ~/.hermes/skills/stockshub-api/SKILL.md
```

## Claude Code (CLAUDE.md)

**文件**: 项目根目录 `CLAUDE.md`

```bash
cp skill/CLAUDE.md ./CLAUDE.md
```

## Codex (codex.md)

**文件**: 项目根目录 `codex.md`

```bash
cp skill/codex.md ./codex.md
```

## OpenClaw

**文件**: `.openclaw/skills/stockshub-api.md`

```bash
mkdir -p .openclaw/skills
cp skill/stockshub-api.md .openclaw/skills/
```

## Cursor (.cursorrules)

**文件**: 项目根目录 `.cursorrules`

```bash
cp skill/.cursorrules ./.cursorrules
```

## 通用 Markdown

所有 AI Agent 都能读取的通用格式：

```bash
# 直接放在项目根目录
cp skill/stockshub-api.md ./API.md
```
