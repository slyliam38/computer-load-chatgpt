import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const [command, args] of [
  [process.execPath, ['--test', 'tests/server.test.mjs', 'tests/widget.test.mjs']],
  [path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py']],
]) {
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (r.error || r.status !== 0) process.exit(r.status ?? 1);
}
