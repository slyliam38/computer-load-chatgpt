import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const result = spawnSync(python, [path.join(root, 'scripts/package.py'), ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', shell: false,
});
if (result.error) console.error('Run npm run setup before packaging.');
process.exitCode = result.status ?? 1;
