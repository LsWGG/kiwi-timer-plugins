<h1 align="center">Kiwi 计时器插件</h1>

<p align="center">
  为 Kiwi 提供的番茄钟与倒计时组件插件，可独立安装、置顶为全局浮窗并长期维护。<br />
  <strong>简体中文</strong> · <a href="README.md">English</a>
</p>

---

本仓库把 Kiwi 示例中的两个计时器拆分为独立项目，便于版本管理、评审与单独发布。

两个区块都声明了 `pinnable: true`。在 Kiwi 中可以从插件卡片、预览弹窗、编辑器区块
工具条或 `Ctrl / ⌘ + K` 命令面板直接置顶为全局浮窗，**不需要先创建或插入笔记**；
切换路由、刷新页面后计时继续。

## 插件

| 插件 | Key | 区块 | 能力 | 全局置顶 |
|---|---|---|---|---|
| 番茄钟 | `pomodoro` | `pomodoro` | 25 分钟专注 / 5 分钟休息循环，开始 / 暂停 / 跳过 / 重置，完成轮数统计，可调时长 | 支持 |
| 倒计时 | `countdown` | `countdown` | 自定义时长，1 / 5 / 10 / 25 / 60 分钟预设，±1 分钟微调，完成次数统计 | 支持 |

两个计时器都用绝对时间戳 `endsAt` 保存运行状态，关闭笔记或刷新页面不会重置；
只在开始、暂停、重置、结束等状态变化时写入 props，不会每秒触发自动保存。

## 环境要求

- Kiwi `0.2.0` 或更新版本，并支持组件插件（`kind: "component"`）。
- 支持 manifest `pinnable` 字段的 Kiwi 构建；旧版本会忽略该字段，仅保留插入用法。
- 仅在本地重新打包时需要 Node.js 18+ 与 `zip`。

## 安装

1. 下载或构建 `dist/pomodoro-1.1.0.zip` / `dist/countdown-1.1.0.zip`。
2. 打开 Kiwi「设置 → 插件与区块 → 导入插件」，选择 zip。
3. 启用插件。
4. 在编辑器中输入 `/番茄钟` 或 `/倒计时` 插入；也可以直接从插件卡片、预览弹窗或
   `Ctrl / ⌘ + K` 命令面板置顶。

同 key 再次导入会原地更新并保留启用状态。

## 目录结构

```
kiwi-timer-plugins/
├── plugins/
│   ├── pomodoro/          # plugin.json、index.js、style.css、README.md
│   └── countdown/
├── docs/
│   ├── DEVELOPMENT.md     # 运行时契约与实现说明
│   └── RELEASING.md       # 版本、打包与发布清单
├── scripts/package.mjs    # 校验 manifest 并生成可安装 zip
├── CHANGELOG.md
├── ROADMAP.md
└── package.json
```

## 开发

没有打包器：`index.js` 是单文件浏览器 ESM，导出 `setup(host)`。修改源码后校验、
打包，再导入 Kiwi 验证。

```bash
npm run validate   # 校验 manifest 与文件大小限制
npm run package    # 生成 dist/pomodoro-1.1.0.zip 与 dist/countdown-1.1.0.zip
```

打包约束：

- `plugin.json`、`index.js`、`style.css`、`README.md` 位于 zip 根目录。
- 入口脚本 ≤ 2 MB，样式 ≤ 512 KB，整包 ≤ 5 MB。
- `key` 匹配 `^[a-z0-9][a-z0-9-]{1,63}$`，安装后不可修改。
- 本仓库所有区块保持 `pinnable: true`。

运行时契约、props 持久化、主题变量与置顶行为见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)；
上游规范见 [Kiwi `docs/PLUGIN_SPEC.md`](https://github.com/LsWGG/Kiwi/blob/main/docs/PLUGIN_SPEC.md)。

## 版本

遵循语义化版本（见 [CHANGELOG.md](CHANGELOG.md)）：

- **主版本**：破坏已保存 `default_props` 或区块契约。
- **次版本**：新增用户可见能力（例如支持 `pinnable`）。
- **修订**：向后兼容的问题修复。

发布包命名为 `dist/<key>-<version>.zip`，与 Git tag / GitHub Release 对应。

## 安全

组件插件是用户在浏览器中导入并启用后执行的第三方代码，可以访问当前页面可用的数据；
只应安装可信来源的插件。Kiwi 服务端不执行插件脚本，公开分享页也不会加载插件运行时。

## 许可

Copyright © 2026 LsWGG. 保留所有权利。见 [LICENSE](LICENSE)。
