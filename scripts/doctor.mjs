/** 检查运行前提，只输出可用状态，不显示登录账户、凭据或配置内容。 */
import { spawnSync } from 'node:child_process';

/** 收集检查结果，所有项目完成后统一设置退出状态。 */
let failed = false;
/** 当前 Node.js 的主次版本。 */
const [major, minor] = process.versions.node.split('.').map(Number);
/** 本项目运行依赖的最小 Node.js 版本。 */
const supportedNode = major > 22 || (major === 22 && minor >= 13);
console.log(`${supportedNode ? '✓' : '✗'} Node.js ${process.versions.node}（要求 22.13+，建议 24 LTS）`);
if (!supportedNode) failed = true;

/** 原生 Windows 尚未验证进程组取消，建议在 WSL2 中启动。 */
if (process.platform === 'win32') {
  console.log('✗ 当前版本请在 WSL2 内安装 Node.js、Codex 并运行；暂不支持原生 Windows。');
  failed = true;
} else {
  console.log(`✓ 系统：${process.platform}（macOS 已验证，Linux 可运行自动检查）`);
}

/** 可选自定义 CLI 路径；从不输出本机绝对路径。 */
const executable = process.env.PAPER_CODEX_BIN || 'codex';
/** 读取非交互帮助来确认所需参数存在。 */
const help = spawnSync(executable, ['exec', '--help'], { encoding: 'utf8', timeout: 10000 });
if (help.status !== 0) {
  console.log('✗ Codex CLI 不可用，请运行 npm install -g @openai/codex，或设置 PAPER_CODEX_BIN。');
  failed = true;
} else {
  /** 当前接入要求的 CLI 参数，避免旧版本静默失败。 */
  const requiredFlags = ['--ignore-user-config', '--ephemeral', '--json', '--skip-git-repo-check'];
  const compatible = requiredFlags.every(flag => help.stdout.includes(flag));
  console.log(compatible ? '✓ Codex CLI 参数兼容' : '✗ Codex CLI 版本过旧，请运行 npm install -g @openai/codex@latest');
  if (!compatible) failed = true;
  /** 仅解释登录检查结果，原始输出不会写入报告或日志。 */
  const login = spawnSync(executable, ['login', 'status'], { encoding: 'utf8', timeout: 10000 });
  const loggedIn = login.status === 0 && /Logged in/i.test(login.stdout + login.stderr);
  console.log(loggedIn ? '✓ Codex 登录可用（不显示账户信息）' : '✗ 尚未登录 Codex，请运行 codex login');
  if (!loggedIn) failed = true;
}

console.log('\n每位使用者需使用自己的 Codex 账户与可用额度；本项目不提供或共享任何账号。');
process.exitCode = failed ? 1 : 0;
