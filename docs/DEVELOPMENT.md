# 开发说明

本文描述本仓库组件插件的实现契约、状态模型与本地验证方式。现有两个计时器是首批插件，后续插件沿用同一契约；上游完整规范见
Kiwi 仓库的 [`docs/PLUGIN_SPEC.md`](https://github.com/LsWGG/Kiwi/blob/main/docs/PLUGIN_SPEC.md)。

## 1. 环境与命令

- Node.js 18+（仅用于运行打包脚本）
- `zip` 命令行工具
- 无 npm 依赖、无构建步骤：`index.js` 直接作为浏览器 ESM 加载

```bash
npm run validate   # 只校验 manifest 与文件限制
npm run package    # 校验并生成 dist/<key>-<version>.zip
```

## 2. 目录结构

```
plugins/pomodoro/
  plugin.json    # manifest：元信息、区块定义、default_props、pinnable
  index.js       # 入口 ESM，导出 setup(host)
  style.css      # 区块样式，颜色使用 --kiwi-* 变量
  README.md      # 用户安装说明
plugins/countdown/  # 同上
scripts/package.mjs # 校验与打包（自动发现 plugins/ 下的新目录）
```

## 3. manifest 契约

顶层字段：

| 字段 | 本仓库取值 | 说明 |
|---|---|---|
| `manifest_version` | `1` | 当前唯一支持的版本 |
| `kind` | `component` | 组件插件 |
| `key` | `pomodoro` / `countdown` | 全局唯一，安装后不可修改 |
| `name` | 番茄钟 / 倒计时 | 显示名称 |
| `version` | 语义化版本 | 与 `package.json`、CHANGELOG、zip 文件名同步 |
| `entry` | `index.js` | 包内相对路径 |
| `style` | `style.css` | 包内相对路径，可选 |
| `blocks` | 各一个区块 | `type` 在插件内唯一 |

区块字段：

| 字段 | 说明 |
|---|---|
| `type` | 区块类型，最终标识为 `<key>:<type>` |
| `label` / `icon` / `description` / `category` | 斜杠菜单展示信息 |
| `default_props` | 首次插入时的 props；必须是可 JSON 序列化的对象 |
| `pinnable` | 允许置顶为全局浮窗；当前两个计时器固定为 `true`，后续插件按区块决定 |

`pinnable` 是宿主能力，插件代码无需为浮窗做适配：浮窗使用同一套组件与 props，
`updateProps` 仍是唯一交互入口。浮窗状态保存在浮窗自己的 props（localStorage）中，
不写回笔记；重复置顶只会聚焦已有窗口。

> 能力随 manifest 一起入库。Kiwi 旧版本忽略 `pinnable`；已安装的旧包需要重新导入
> 更新后的 zip（覆盖安装）才会获得置顶入口。

## 4. 运行时契约

入口必须导出 `setup(host)`（或 `export default` 等价形式），返回区块注册表：

```js
export function setup(host) {
  const { defineComponent, h, ref, computed, onMounted, onBeforeUnmount } = host.vue
  // ...
  return {
    blocks: {
      pomodoro: { component: PomodoroBlock, defaultProps: { /* ... */ } },
    },
  }
}
```

可用的 host API：

| 字段 | 说明 |
|---|---|
| `host.vue` | Vue 运行时命名空间；入口不能 `import "vue"` |
| `host.toast` | `toast.success(text)` / `toast.error(text)` |
| `host.theme` | `version` / `accent` / `accentStrong` / `accentSoft` / `shade(step, alpha)` |
| `host.apiVersion` | 当前为 `1` |

宿主传给组件的 props：

| Prop | 类型 | 说明 |
|---|---|---|
| `blockProps` | Object | 当前持久化的 props |
| `readonly` | Boolean | 阅读视图、分享页或只读预览时为 `true`，不得写状态 |
| `selected` | Boolean | 区块被选中；用于显示删除按钮 |
| `updateProps` | Function \| null | 接收 patch 对象，由宿主合并并持久化 |
| `deleteBlock` | Function \| null | 删除区块（仅选中态使用） |

约束：

- `index.js` 必须是单文件浏览器 ESM，不能 import 裸模块或相对文件。
- 不访问网络、不读写插件之外的存储、不修改全局状态。
- props 只放可 JSON 序列化的值；浮窗与笔记都依赖这一契约。
- 所有按钮显式设置 `type="button"`，并提供 `title` 或可见文案。

## 5. 状态模型

两个插件采用相同的计时模型：

- `running` 表示是否运行，`endsAt` 是**绝对毫秒时间戳**，`remaining` 是暂停时的剩余秒数。
- 运行时剩余时间由 `endsAt - Date.now()` 推导，因此刷新页面、切换路由、浮窗重挂载都能接续。
- 组件内每 250ms 更新本地 `now` ref；**不**每秒调用 `updateProps`。
- 只在开始、暂停、重置、调整时长、阶段切换、结束时写入 props。
- 归零处理使用 `completedEndsAt` 记录已处理的 `endsAt`，避免宿主回写延迟时重复推进阶段。
- 读取 props 时统一做范围收敛，避免手工编辑围栏 JSON 造成负值或超长计时。

番茄钟 props：

| 字段 | 范围 / 取值 | 说明 |
|---|---|---|
| `focusMinutes` | 5–90，5 分钟步进 | 专注时长 |
| `breakMinutes` | 1–30，1 分钟步进 | 休息时长 |
| `phase` | `focus` / `break` | 当前阶段 |
| `running` | Boolean | 是否运行 |
| `endsAt` | 毫秒时间戳，暂停时为 0 | 结束时刻 |
| `remaining` | 秒 | 暂停剩余 |
| `completedFocus` | ≥ 0 整数 | 完成的专注轮数 |

倒计时 props：

| 字段 | 范围 / 取值 | 说明 |
|---|---|---|
| `title` | ≤ 40 字符 | 卡片标题 |
| `durationSeconds` | 60–21600 | 总时长 |
| `remaining` | 0–`durationSeconds` | 暂停剩余 |
| `running` | Boolean | 是否运行 |
| `endsAt` | 毫秒时间戳，暂停时为 0 | 结束时刻 |
| `completedCount` | ≥ 0 整数 | 完成次数 |

运行中禁止调整时长；倒计时结束后自动停止并累计 `completedCount`，「再来一次」从完整时长重新开始。

## 6. 主题

颜色必须来自 Kiwi 主题变量（RGB 三元组），不要写死品牌色：

```css
.kiwi-pomodoro {
  background: rgb(var(--kiwi-500) / 0.08);
  border-color: rgb(var(--kiwi-500) / 0.35);
  color: rgb(var(--kiwi-700));
}
```

需要强调色时使用 `--kiwi-400` / `--kiwi-500` / `--kiwi-600`，并在亮色、暗色与学习模式
主题下分别检查对比度。不要在插件内定义全局 `:root` 变量。

## 7. 打包规则

`scripts/package.mjs` 会校验：

- `manifest_version === 1`、`kind === "component"`、`key` 匹配 `^[a-z0-9][a-z0-9-]{1,63}$`
- `version` 为语义化版本，`blocks` 非空且 `type` 不重复
- `pinnable` 若声明必须是布尔值；当前 `pomodoro` / `countdown` 必须为 `true`
- 必需文件存在；入口 ≤ 2 MB，样式 ≤ 512 KB
- zip 内文件位于**根目录**，不嵌套目录

`zip -X` 不写入额外属性，保证同一份源码可复现出内容一致的包。

## 8. 本地验证

1. `npm run package`，得到 `dist/<key>-<version>.zip`。
2. 在 Kiwi「设置 → 插件与区块」导入；若已安装同 key，确认覆盖安装并保留启用状态。
3. 在编辑器中输入 `/番茄钟` 或 `/倒计时`，检查插入、开始 / 暂停 / 重置、时长调整。
4. 运行中刷新页面或切换笔记，确认剩余时间接续而非重置。
5. 从插件卡片图钉菜单、预览弹窗「置顶」、区块工具条或 `Ctrl / ⌘ + K` 各置顶一次，
   确认浮窗可拖动、缩放，重复置顶只聚焦而不重置。
6. 在阅读视图与公开分享页检查按钮隐藏、计时仍按时间戳推进。
7. 覆盖安装回 1.0.0 可验证旧版本兼容性；测试完再装回当前版本。

## 9. 提交约定

- 只改必要的 manifest / 源码 / 文档，不提交 `dist/`。
- 用户可见变更必须更新 `CHANGELOG.md`；行为或兼容性变化同步更新 README。
- 版本发布流程见 [RELEASING.md](RELEASING.md)。
