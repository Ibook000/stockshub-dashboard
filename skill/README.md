# Agent 接入

StocksHub 2.0 提供本机研究 API。统一文档：[stockshub-api.md](stockshub-api.md)。默认服务地址为 `http://127.0.0.1:8765`。

Hermes 等支持技能目录的代理，可将 `stockshub-api.md` 复制到对应目录并命名为 `SKILL.md`；其他代理可直接读取该文件。不要把本项目的接入说明覆盖为你的全局代理配置。

Pages 版只有浏览器本地数据，不提供这些 API。个人数据迁移使用网页上的 JSON 导出/导入。
