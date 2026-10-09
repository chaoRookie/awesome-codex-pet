# @legeling/codex-pet CLI

轻量 npm 安装器，支持 macOS、Linux 和 Windows。需要 Node.js 20+（包含 npm）。包内没有宠物素材，运行时按需读取远程目录并下载选中的宠物。

```bash
# 交互菜单：浏览、搜索、下载、贡献（需要交互终端）
npx @legeling/codex-pet --lang zh

# 无需全局安装
npx --yes @legeling/codex-pet list
npx --yes @legeling/codex-pet search 皮卡丘
npx --yes @legeling/codex-pet install firefly--lingxiaotian
npx --yes @legeling/codex-pet download firefly--lingxiaotian --output ./downloads
npx --yes @legeling/codex-pet contribute --lang zh

# 可选全局安装，两个命令名等效
npm install -g @legeling/codex-pet
cpet list
codex-pet list
```

## 行为

- 无参数进入分页菜单，每页最多 20 只；非交互环境显示帮助并退出，不等待输入。
- `search` 匹配宠物 ID、默认名称和目录中已提供的中英文名称，多个关键词同时匹配。无结果正常退出。
- `install <id>` 安装到 `$CODEX_HOME/pets/<id>/`，默认用户主目录下的 `.codex/pets/<id>/`。支持 `--codex-home <path>`。
- `download <id> --output <path>` 保存到 `<path>/<id>/`，仅包含经过校验的 `pet.json` 和 `spritesheet.webp`，可用于本地安装；不是完整投稿包，不包含 `submission.json`，也不上报安装计数。
- 已存在的宠物需显式添加 `--force`。先校验大小、SHA-256、WebP 文件头和 ID，再暂存并切换；失败清理暂存文件，切换失败恢复原目录。含额外文件或符号链接的现有包拒绝覆盖。
- 每次命令仅加载一次有大小上限的清单；按需下载两个文件，每次请求最多等待 120 秒，不自动重试。网络失败可重新执行命令。
- `contribute` 输出制作请求和投稿指南链接，不上传、不创建 Issue/PR。投稿依照现有网站流程，需要作者、来源、许可和视觉检查。
- `--lang en|zh` 控制菜单语言，默认跟随终端语言。`--list` 和直接传入宠物 ID 的旧参数形式继续兼容。
- 安装成功后会发送一次匿名安装事件，使用 `--no-stats` 或 `AWESOME_CODEX_PET_NO_STATS=1` 关闭；仅下载不会计数。
- CLI 安装完成后，到 Codex 设置中选择宠物；如未显示，重启 Codex。

## 发布和兼容性

网站、导出目录和 README 共用 `scripts/install-command.mjs`，统一展示 npm 命令。旧 Bash/PowerShell 脚本保留，供已有外部链接继续使用。

npm 包发布后才能使用上述远程命令。应先发布并验证 npm 包，再部署引用这些命令的网站；本地开发可用 `node scripts/install-pet-remote.mjs` 代替 `npx @legeling/codex-pet`。

发布前运行 `npm run test:install`、`npm run test:package`、`npm run lint`，检查 `npm pack --dry-run --json`。确认版本和发布文件后执行 `npm publish --access public`。Git 提交、推送和网站部署分别按发布授权执行。

默认读取 GitHub main 上的最新安装清单。复现某次安装时，同时固定 npm 版本（例如 `@legeling/codex-pet@0.1.0`）和 `--raw-base https://raw.githubusercontent.com/legeling/awesome-codex-pet/<commit>`。环境变量 `AWESOME_CODEX_PET_RAW_BASE` 也可覆盖来源，仅允许不含凭据、查询或片段的 HTTPS URL。

需要回退 CLI 时使用明确的旧 npm 版本。网站命令可随代码版本回退；已有宠物文件不会随 CLI 卸载或升级而删除。

## English quick reference

Requires Node.js 20+ with npm. Run `npx @legeling/codex-pet` for an interactive menu, or use `list`, `search <words>`, `install <id>`, `download <id> --output <directory>`, and `contribute`. Global installation exposes both `codex-pet` and `cpet`.

Assets are fetched on demand. Downloads contain two runtime files, not the three-file contribution package. Use `--force` to replace an existing managed package, `--no-stats` to skip install statistics, and `--lang en` for the English menu. Contribution commands print the existing website workflow without uploading files. Publish and verify the npm package before deploying the updated website.
