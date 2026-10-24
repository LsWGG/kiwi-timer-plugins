# 发布流程

本文是 Kiwi 计时器插件的版本发布清单。目标：manifest、`package.json`、CHANGELOG、
Git tag 与发布包版本始终一致。

## 1. 版本策略

遵循语义化版本：

- **主版本**：破坏已保存 `default_props`、区块 `type` 或运行时契约。
- **次版本**：向下兼容的新能力，例如 `pinnable`、长休息、提醒。
- **修订版本**：向下兼容的问题修复。

`key`（`pomodoro` / `countdown`）安装后不可修改；功能变化只能通过 `version` 表达。

## 2. 发布前检查

1. 确认工作区干净，功能已在 Kiwi 中手工验收（见第 3 节）。
2. 同步版本号，四处必须一致：
   - `plugins/pomodoro/plugin.json` → `version`
   - `plugins/countdown/plugin.json` → `version`
   - `package.json` → `version`
   - `CHANGELOG.md` → 新版本小节
3. 更新 README 中出现的版本号与兼容性说明（如行为有变化）。
4. 校验并打包：

   ```bash
   npm run validate
   npm run package
   ```

5. 检查产物：

   ```bash
   unzip -l dist/pomodoro-1.1.0.zip
   unzip -p dist/pomodoro-1.1.0.zip plugin.json | grep -E '"version"|"pinnable"'
   unzip -p dist/countdown-1.1.0.zip plugin.json | grep -E '"version"|"pinnable"'
   sha256sum dist/*.zip
   ```

   预期：每个 zip 只有 `plugin.json`、`index.js`、`style.css`、`README.md` 四个文件，
   且都位于根目录；manifest 版本与 `pinnable: true` 正确。

## 3. 在 Kiwi 中验收

至少覆盖以下场景，再对外发布：

- [ ] 全新导入两个 zip，插件卡片、预览、斜杠菜单正常。
- [ ] 番茄钟完成一次专注 → 休息 → 下一轮，轮数累计正确。
- [ ] 倒计时归零后停止并累计完成次数，「再来一次」重置为完整时长。
- [ ] 运行中刷新页面、切换路由、关闭再打开笔记，剩余时间接续。
- [ ] 四种置顶入口均可用；浮窗可拖动、缩放；重复置顶不重置计时。
- [ ] 阅读视图与公开分享页按钮隐藏，计时按时间戳推进。
- [ ] 覆盖安装同 key 新版本，启用状态与已插入区块保持不变。
- [ ] 旧版 Kiwi（不支持 `pinnable`）导入不报错，仅无置顶入口。

## 4. 提交与打标签

```bash
git add -A
git commit -m "release: v1.1.0"
git tag -a v1.1.0 -m "Kiwi timer plugins v1.1.0"
```

`dist/` 已被 `.gitignore` 忽略；发布包通过 GitHub Release 附件分发，不进入源码历史。

## 5. 推送到远端

首次发布时配置远端（仓库名与项目目录一致）：

```bash
git remote add origin git@github.com:LsWGG/kiwi-timer-plugins.git
git push -u origin main
git push origin v1.1.0
```

使用 HTTPS 时改为 `https://github.com/LsWGG/kiwi-timer-plugins.git`。

## 6. 创建 GitHub Release

```bash
gh release create v1.1.0 \
  dist/pomodoro-1.1.0.zip dist/countdown-1.1.0.zip \
  --title "v1.1.0 · 全局置顶支持" \
  --notes-file <(sed -n '/## 1.1.0/,/## 1.0.0/p' CHANGELOG.md | head -n -1)
```

没有 `gh` 时在 GitHub 网页端创建 tag `v1.1.0` 的 Release，附上两个 zip，并把
CHANGELOG 对应小节粘贴到说明中。

发布后再次下载附件，核对 `sha256sum` 与本地产物一致。

## 7. 回滚

1. 保留已发布的版本包，不要覆盖同名 zip。
2. 在 Kiwi 中重新导入上一版本的 zip 即可回退；`key` 不变，启用状态保留。
3. 若新版本引入了新 props 字段，回退后这些字段会被旧代码忽略，不会破坏已有数据。
4. 在 GitHub 上将问题版本标记为 pre-release 或删除 Release，并发布修订版本说明。

## 8. 发布清单

- [ ] 版本号四处一致
- [ ] CHANGELOG 已更新（新增 / 变更 / 修复 / 兼容性）
- [ ] `npm run validate` 通过
- [ ] `npm run package` 生成两个 zip
- [ ] zip 根目录文件与 manifest 校验通过
- [ ] Kiwi 手工验收清单全部通过
- [ ] commit、tag、push 完成
- [ ] GitHub Release 附件已上传并回下载核对
