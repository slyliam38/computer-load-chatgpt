const $ = id => document.getElementById(id);
const local = window.parent === window;
let report, csrf, busy = false, sorting = 'cpu', proposalSignature = '';
const fmt = value => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const bytes = n => n == null ? 'н/д' : n >= 1024 ** 3 ? fmt(n / 1024 ** 3) + ' ГБ' : n >= 1024 ** 2 ? fmt(n / 1024 ** 2) + ' МБ' : fmt(n / 1024) + ' КБ';
const rate = n => n == null ? 'н/д' : bytes(n) + '/с';
function message(text, error = false) { $('message').textContent = text; $('message').dataset.error = String(error); }
function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function fill(id, value) { $(id).style.width = Math.min(100, Math.max(0, Number(value))) + '%'; }

function render(data) {
  if (!data?.snapshot_id || !data.cpu || !data.memory || !data.disk || !data.network ||
      !data.capabilities || !Array.isArray(data.cpu.samples_percent) ||
      !Array.isArray(data.findings) || !Array.isArray(data.processes)) {
    throw new Error('Получен неполный отчёт. Повторите проверку.');
  }
  report = data;
  $('status').dataset.level = data.severity;
  const label = { normal: 'Явной перегрузки не видно', watch: 'Стоит проверить', high: 'Есть признаки перегрузки' }[data.severity];
  $('status-text').textContent = `${label} · ${data.platform} · ${new Date(data.measured_at).toLocaleTimeString('ru-RU')} · ${fmt(data.sample_seconds)} с`;
  $('cpu-value').textContent = fmt(data.cpu.average_percent) + '%';
  $('cpu-detail').textContent = `${data.cpu.logical_cores} логических ядер · замеры ${data.cpu.samples_percent.map(fmt).join(' / ')}%`;
  fill('cpu-fill', data.cpu.average_percent);
  $('memory-value').textContent = fmt(data.memory.used_percent) + '%';
  $('memory-detail').textContent = `Доступно ${bytes(data.memory.available_bytes)} из ${bytes(data.memory.total_bytes)} · swap ${bytes(data.memory.swap_used_bytes)}`;
  fill('memory-fill', data.memory.used_percent);
  $('disk-value').textContent = bytes(data.disk.free_bytes);
  $('disk-detail').textContent = `${fmt(data.disk.free_percent)}% свободно · чтение ${rate(data.disk.read_bytes_per_second)}, запись ${rate(data.disk.write_bytes_per_second)}`;
  fill('disk-fill', 100 - data.disk.free_percent);
  $('network-value').textContent = `${fmt((data.network.received_bytes_per_second ?? 0) / 1024 ** 2)} / ${fmt((data.network.sent_bytes_per_second ?? 0) / 1024 ** 2)}`;
  $('network-detail').textContent = 'МБ/с · сумма по сетевым интерфейсам';
  $('findings').replaceChildren(...data.findings.map(f => {
    const item = el('article', null, 'finding'); item.dataset.level = f.level;
    item.append(el('h3', f.title), el('p', f.detail)); return item;
  }));
  $('coverage').textContent = `Видно ${data.processes_seen} процессов; в списке ${data.processes.length}. Недоступны или завершились: ${data.unreadable_or_exited}. ` + (data.capabilities.per_process_io ? '' : 'Дисковая активность отдельных процессов на этой ОС недоступна. ') + 'Сумма RSS может учитывать общую память несколько раз.';
  $('export').disabled = false;
  if (!busy) $('scan').textContent = 'Повторить проверку';
  renderProcesses();
}

function renderProcesses() {
  if (!report) return;
  const rows = [...report.processes].sort((a, b) => sorting === 'cpu' ? b.cpu_one_core_percent - a.cpu_one_core_percent : b.rss_bytes - a.rss_bytes);
  $('processes').replaceChildren(...rows.map(p => {
    const tr = el('tr'), name = el('td'); name.append(el('div', p.name, 'name'), el('div', `PID ${p.pid}`, 'pid'));
    const action = el('td');
    if (p.action.mode === 'confirm') {
      const button = el('button', 'Запросить закрытие');
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await call('prepare_process_stop', { snapshot_id: report.snapshot_id, process_id: p.process_id });
          const proposal = result.structuredContent ?? result;
          if (local) await pending();
          message(`${proposal.name}: запрос подготовлен. Подтвердите на компьютере в панели http://127.0.0.1:8798. До подтверждения процесс работает.`);
        } catch (err) { message(err.message ?? String(err), true); }
        finally { button.disabled = false; }
      });
      action.append(button, el('div', p.action.reason, 'action-note'));
    } else action.append(el('div', p.action.mode === 'protected' ? 'Остановка заблокирована' : 'Закрыть обычным способом', 'name'), el('div', p.action.reason, 'action-note'));
    tr.append(name, el('td', fmt(p.cpu_one_core_percent) + '%', 'num'), el('td', bytes(p.rss_bytes), 'num'), el('td', rate(p.read_bytes_per_second) + ' / ' + rate(p.write_bytes_per_second), 'num'), action);
    return tr;
  }));
}

const requests = new Map();
let nextId = 0, bridgeReady;
function toolResult(result) {
  if (result?.isError) {
    message(result.content?.find(c => c.type === 'text')?.text ?? 'Ошибка диагностики. Повторите проверку.', true);
    return;
  }
  try { render(result?.structuredContent ?? result); message('Замер готов. Перед закрытием приложения сохраните работу.'); }
  catch (err) { message(err.message ?? 'Не удалось показать отчёт. Повторите проверку.', true); }
}
function notify(method, params = {}) { window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*'); }
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('Чат не ответил. Повторите позже.')); }, 20000);
    requests.set(id, { resolve, reject, timer });
    window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
  });
}
window.addEventListener('message', event => {
  if (local || event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
  const msg = event.data;
  if (requests.has(msg.id)) {
    const pending = requests.get(msg.id); clearTimeout(pending.timer); requests.delete(msg.id);
    msg.error ? pending.reject(new Error(msg.error.message ?? 'Ошибка чата')) : pending.resolve(msg.result);
  } else if (msg.method === 'ui/notifications/tool-result') toolResult(msg.params);
  else if (msg.method === 'ui/notifications/tool-cancelled') message('Проверка отменена. Можно запустить её повторно.', true);
});
async function api(route, args) {
  const res = await fetch(route, args ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(args) } : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Ошибка запроса');
  return data;
}
async function call(name, args) {
  if (local) return api({ diagnose_computer: '/api/diagnose', prepare_process_stop: '/api/prepare' }[name], args);
  await bridgeReady;
  const response = await rpc('tools/call', { name, arguments: args });
  if (response.isError) throw new Error(response.content?.find(c => c.type === 'text')?.text ?? 'Ошибка инструмента');
  return response;
}
async function pending() {
  if (!local || busy) return;
  const data = await api('/api/pending');
  const signature = data.proposals.map(p => p.proposal_id).join(',');
  if (signature === proposalSignature) return; // Preserve typed local confirmation.
  proposalSignature = signature;
  $('proposals').replaceChildren(...data.proposals.map(p => {
    const form = el('form', null, 'proposal'); form.append(el('h3', `${p.name} · PID ${p.pid}`), el('p', p.warning + ` Осталось примерно ${p.seconds_remaining} с.`));
    const input = el('input'); input.type = 'text'; input.placeholder = `Введите ${p.name}`; input.autocomplete = 'off'; input.required = true; input.setAttribute('aria-label', `Введите точное имя ${p.name}`);
    const checkLabel = el('label', null, 'check'), check = el('input'); check.type = 'checkbox'; check.required = true; checkLabel.append(check, document.createTextNode(' Я сохранил работу и хочу закрыть это приложение'));
    const button = el('button', 'Подтвердить закрытие на компьютере'); button.type = 'submit';
    form.append(input, checkLabel, button);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return; busy = true; button.disabled = true;
      try {
        const result = await api('/api/confirm', { proposal_id: p.proposal_id, confirmation: input.value, saved_work: check.checked });
        message(`${result.name}: ${result.outcome ?? result.status}`);
      } catch (err) { message(err.message, true); }
      finally { busy = false; button.disabled = false; await pending(); }
    }); return form;
  }));
} // Confirmation forms never exist inside the ChatGPT widget.

$('scan').addEventListener('click', async () => {
  if (busy) return; busy = true; $('scan').disabled = true; $('scan').textContent = 'Измеряю…'; message('Собираю несколько замеров. Процессы продолжают работать.');
  try { const result = await call('diagnose_computer', { seconds: 3, limit: 25 }); render(result.structuredContent ?? result); message('Замер готов. Перед закрытием приложения сохраните работу.'); }
  catch (err) { message(err.message ?? String(err), true); }
  finally { busy = false; $('scan').disabled = false; $('scan').textContent = 'Повторить проверку'; }
});
for (const key of ['cpu', 'memory']) $('sort-' + key).addEventListener('click', () => {
  sorting = key; $('sort-cpu').setAttribute('aria-pressed', String(key === 'cpu')); $('sort-memory').setAttribute('aria-pressed', String(key === 'memory')); renderProcesses();
});
$('export').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = el('a'); a.href = url; a.download = 'computer-load-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('pending-refresh').addEventListener('click', () => pending().catch(err => message(err.message, true)));
if (local) {
  $('approvals').hidden = false;
  try { ({ csrf } = await api('/api/session')); await pending(); }
  catch (err) { message(err.message, true); $('scan').disabled = true; }
  setInterval(() => { if (!document.hidden && !busy) pending().catch(() => {}); }, 5000);
} else {
  $('export').hidden = true; // Host download support is not assumed inside the sandbox.
  bridgeReady = rpc('ui/initialize', { appInfo: { name: 'computer-load-dashboard', version: '0.1.3' }, appCapabilities: {}, protocolVersion: '2026-01-26' })
    .then(result => {
      if (result?.protocolVersion !== '2026-01-26' || !result.hostCapabilities || !result.hostContext) {
        throw new Error('Чат не поддерживает связь с этим виджетом.');
      }
      notify('ui/notifications/initialized');
      // Let an inline host grow with the report instead of clipping the table.
      if (typeof ResizeObserver !== 'undefined') {
        let lastHeight;
        const size = () => {
          const height = Math.ceil(document.body.getBoundingClientRect().height);
          if (height !== lastHeight) { lastHeight = height; notify('ui/notifications/size-changed', { height }); }
        };
        new ResizeObserver(size).observe(document.body);
        size();
      }
    });
  bridgeReady.catch(err => message(err.message, true));
  if (window.openai?.toolOutput) toolResult(window.openai.toolOutput);
  window.addEventListener('openai:set_globals', event => { if (event.detail?.globals?.toolOutput) toolResult(event.detail.globals.toolOutput); });
}
