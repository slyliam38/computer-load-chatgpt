import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw new Error(`Не найден ${command}. Для запуска нужны Node.js 20+ и Python 3.9+.`);
  if (result.status !== 0) throw new Error(`Операция ${command} завершилась с кодом ${result.status}. Причина указана выше.`);
}
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) run(process.platform === 'win32' ? 'py' : 'python3', process.platform === 'win32' ? ['-3', '-m', 'venv', '.venv'] : ['-m', 'venv', '.venv']);
run(python, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
// npm.cmd is a Windows batch file. Launch its JS entry point through node, without shell interpolation.
const npmCli = process.env.npm_execpath;
const installCommand = existsSync(path.join(root, 'package-lock.json')) ? 'ci' : 'install';
if (npmCli) run(process.execPath, [npmCli, installCommand, '--ignore-scripts']);
else if (process.platform !== 'win32') run('npm', [installCommand, '--ignore-scripts']);
else {
  const npmPath = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npmPath)) throw new Error('Запустите npm run setup из папки проекта.');
  run(process.execPath, [npmPath, installCommand, '--ignore-scripts']);
}
console.log('Готово. Запустите npm start и откройте http://127.0.0.1:8798');
