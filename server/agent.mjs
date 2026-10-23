import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import path from 'node:path';

export class Agent {
  constructor(root) {
    const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    // Codex's package copier omits venv interpreter symlinks on macOS.
    // The isolated bootstrap loads only the matching bundled dependencies.
    const packagedFallback = process.platform !== 'win32' && !existsSync(localPython) && existsSync(path.join(root, '.venv/lib'));
    if (!existsSync(localPython) && !packagedFallback) throw new Error('Сначала запустите node scripts/setup.mjs');
    const python = packagedFallback ? 'python3' : localPython;
    const args = packagedFallback ? ['-I', '-u', path.join(root, 'agent/bootstrap.py')] : ['-u', path.join(root, 'agent/worker.py')];
    this.child = spawn(python, args, {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.id = 0;
    this.pending = new Map();
    this.queue = Promise.resolve();
    createInterface({ input: this.child.stdout }).on('line', line => {
      let data;
      try { data = JSON.parse(line); } catch { this.fail(new Error('Некорректный ответ агента')); return; }
      const p = this.pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(data.id);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
    });
    // Never log raw process metadata or errors containing private paths.
    this.child.stderr.on('data', () => {});
    this.child.on('error', () => this.fail(new Error('Не удалось запустить агент')));
    this.child.on('exit', () => this.fail(new Error('Агент остановлен. Перезапустите приложение.')));
  }
  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
  call(op, args = {}) {
    // Backpressure: bound queued requests as well as active work.
    this.queued = (this.queued ?? 0) + 1;
    if (this.queued > 6) { this.queued--; return Promise.reject(new Error('Агент занят. Повторите позже.')); }
    const job = this.queue.then(() => new Promise((resolve, reject) => {
      if (this.child.exitCode !== null || this.child.killed) return reject(new Error('Агент недоступен'));
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Время ожидания истекло. Исход действия неизвестен; не повторяйте его автоматически.'));
        // Unknown-outcome work is not retried; terminate only our own IPC worker.
        this.child.kill();
      }, 25000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, op, args }) + '\n', err => {
        if (err) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Агент недоступен')); }
      });
    })).finally(() => { this.queued--; });
    this.queue = job.catch(() => {});
    return job;
  }
  close() { this.child.stdin.end(); }
}
