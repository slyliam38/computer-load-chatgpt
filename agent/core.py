"""Bounded read-only sampling and a fail-closed process termination policy."""
import os
import ntpath
import platform
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

import psutil

PROCESS_ERRORS = (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess)
DENIED = re.compile(
    r"1cv8|1cestart|ragent|rmngr|rphost|postgres|mysql|mariadb|mongod|redis|"
    r"sqlservr|oracle|backup|timemachine|sync|onedrive|dropbox|security|antivirus|"
    r"defender|vpn|anydesk|teamviewer|rdp|windowserver|kernel|launchd|loginwindow|"
    r"finder|dock|system|codex|chatgpt|terminal|python|node|tunnel-client",
    re.IGNORECASE,
)
KNOWN_MEDIA = {"VLC": "VLC.app", "IINA": "IINA.app", "Spotify": "Spotify.app"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def identity(proc):
    with proc.oneshot():
        return {"pid": proc.pid, "created": proc.create_time(), "name": proc.name(),
                "exe": proc.exe(), "owner": proc.username()}


def current_owner():
    return psutil.Process().username()


def policy(info, owner=None, system=None, protected_pids=None):
    """Unknown, background, privileged and business processes are never stoppable."""
    owner = owner if owner is not None else current_owner()
    system = system or platform.system()
    if info["pid"] <= 1 or info["pid"] in (protected_pids or {os.getpid(), os.getppid()}):
        return {"mode": "protected", "reason": "Системный процесс или сам диагностический агент."}
    if not info.get("owner") or info["owner"] != owner or info["owner"] in {"root", "SYSTEM"}:
        return {"mode": "protected", "reason": "Процесс другого пользователя или системной службы."}
    if DENIED.search(info.get("name", "") + " " + info.get("exe", "")):
        return {"mode": "protected", "reason": "Служба, рабочие данные, синхронизация или средство доступа. Остановка заблокирована."}
    if system == "Windows":
        name, exe = info.get("name", "").lower(), info.get("exe", "")
        candidates = []
        for variable in ("ProgramFiles", "ProgramFiles(x86)"):
            base = os.environ.get(variable)
            if base:
                candidates.append(("vlc.exe", ntpath.join(base, "VideoLAN", "VLC", "vlc.exe")))
                candidates.append(("spotify.exe", ntpath.join(base, "Spotify", "Spotify.exe")))
        if os.environ.get("APPDATA"):
            candidates.append(("spotify.exe", ntpath.join(os.environ["APPDATA"], "Spotify", "Spotify.exe")))
        if any(name == n and ntpath.normcase(exe) == ntpath.normcase(p) for n, p in candidates):
            return {"mode": "confirm", "reason": "Медиаприложение. После подтверждения будет отправлен обычный запрос закрытия окна; принудительное завершение запрещено."}
        return {"mode": "manual", "reason": "Безопасность закрытия не подтверждена. Сохраните работу и закройте приложение обычным способом."}
    if system != "Darwin":
        return {"mode": "manual", "reason": "На этой ОС завершение через агент пока не поддерживается. Закройте приложение обычным способом."}
    name, exe = info.get("name"), info.get("exe", "")
    if name in KNOWN_MEDIA and exe:
        app = KNOWN_MEDIA[name]
        expected = [str(Path("/Applications") / app / "Contents/MacOS" / name),
                    str(Path.home() / "Applications" / app / "Contents/MacOS" / name)]
        if exe in expected:
            return {"mode": "confirm", "reason": "Медиаприложение. Можно запросить завершение после сохранения работы и подтверждения на компьютере."}
    return {"mode": "manual", "reason": "Назначение или безопасность завершения не подтверждены. Сохраните работу и закройте приложение обычным способом."}


def request_close(proc):
    if platform.system() != "Windows":
        proc.terminate()  # SIGTERM only, never SIGKILL.
        return
    # psutil.terminate() on Windows is TerminateProcess, so use WM_CLOSE instead.
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    handles = []
    @callback_type
    def collect(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == proc.pid and user32.IsWindowVisible(hwnd):
            handles.append(hwnd)
        return True
    user32.EnumWindows(collect, 0)
    if not handles:
        raise ValueError("У процесса нет видимого окна. Закройте его через само приложение.")
    sent = False
    for hwnd in handles:
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if proc.is_running() and pid.value == proc.pid:
            sent = bool(user32.PostMessageW(hwnd, 0x0010, 0, 0)) or sent
    if not sent:
        raise ValueError("Обычный запрос закрытия окна не удалось отправить.")


def io_bytes(proc):
    try:
        io = proc.io_counters()
        return io.read_bytes, io.write_bytes
    except (AttributeError, NotImplementedError, *PROCESS_ERRORS):
        return None


def recommendations(report):
    findings = []
    samples = report["cpu"]["samples_percent"]
    if samples and min(samples) >= 85:
        findings.append({"level": "high", "title": "Процессор занят на всех замерах",
                         "detail": "Нагрузка выше 85% во всех коротких замерах. Проверьте первые процессы в списке; повторите измерение через минуту."})
    elif report["cpu"]["average_percent"] >= 60:
        findings.append({"level": "watch", "title": "Заметная нагрузка на процессор",
                         "detail": "Возможно, идёт полезная работа: сборка, видео, индексация. Сам процент не означает, что процесс нужно остановить."})
    mem = report["memory"]
    if mem["available_percent"] < 5 or (mem["used_percent"] >= 90 and mem["swap_growth_bytes"] > 0):
        findings.append({"level": "high", "title": "Мало доступной памяти",
                         "detail": "Сохраните работу и закройте ненужные приложения и вкладки. Оценка основана на доступной памяти и swap; нативное давление памяти macOS не измерено."})
    elif mem["available_percent"] < 15:
        findings.append({"level": "watch", "title": "Небольшой запас памяти",
                         "detail": "Повторите замер во время торможения. Занятая память и кеш сами по себе не доказывают проблему."})
    disk = report["disk"]
    if disk["free_percent"] < 5:
        findings.append({"level": "high", "title": "На системном диске почти нет места",
                         "detail": "Освободите место через проверенные файлы и настройки хранения. Завершение процесса не освободит занятые файлы."})
    elif disk["free_percent"] < 15:
        findings.append({"level": "watch", "title": "Мало свободного места на диске",
                         "detail": "Проверьте настройки хранения и большие ненужные файлы. Агент ничего не удаляет."})
    if not findings:
        findings.append({"level": "normal", "title": "По короткому замеру явной перегрузки нет",
                         "detail": "Если торможение повторяется, сделайте замер в этот момент. Проверка не исключает перегрев, сбой диска или проблемы отдельного приложения."})
    return findings


def sample(seconds=3, limit=25):
    if type(seconds) is not int or not 2 <= seconds <= 10:
        raise ValueError("Длительность должна быть целым числом от 2 до 10 секунд.")
    if type(limit) is not int or not 5 <= limit <= 50:
        raise ValueError("Количество процессов: от 5 до 50.")
    started = time.monotonic()
    owner = current_owner()
    protected = {os.getpid(), os.getppid()}
    try:
        protected.update(p.pid for p in psutil.Process().parents())
    except PROCESS_ERRORS:
        pass
    records = []
    unreadable = 0
    for proc in psutil.process_iter():
        try:
            with proc.oneshot():
                ct = proc.cpu_times()
                name = proc.name()
                created = proc.create_time()
            records.append({"proc": proc, "cpu_start": ct.user + ct.system,
                            "time_start": time.monotonic(), "io_start": io_bytes(proc),
                            "name": name, "created": created})
        except PROCESS_ERRORS:
            unreadable += 1
    psutil.cpu_percent(None)  # Discard the first, meaningless nonblocking value.
    disk_start = psutil.disk_io_counters()
    net_start = psutil.net_io_counters()
    swap_start = psutil.swap_memory().used
    rates_start = time.monotonic()
    cpu_samples = []
    for _ in range(seconds):
        time.sleep(1)
        cpu_samples.append(psutil.cpu_percent(None))
    rates_elapsed = max(time.monotonic() - rates_start, 0.01)
    cores = psutil.cpu_count() or 1
    public, private = [], {}
    per_process_io = False
    for rec in records:
        p = rec["proc"]
        try:
            with p.oneshot():
                # Verify start-time and name: PID reuse must not attribute another process.
                if not p.is_running() or p.create_time() != rec["created"] or p.name() != rec["name"]:
                    continue
                ct = p.cpu_times()
                rss = p.memory_info().rss
                state = p.status()
            cpu = max(0, (ct.user + ct.system - rec["cpu_start"]) / max(time.monotonic() - rec["time_start"], 0.01) * 100)
            try:
                info = identity(p)
            except PROCESS_ERRORS:
                info = {"pid": p.pid, "created": rec["created"], "name": rec["name"], "exe": "", "owner": ""}
            action = policy(info, owner, protected_pids=protected)
            start_io, end_io = rec["io_start"], io_bytes(p)
            read_rate = write_rate = None
            if start_io is not None and end_io is not None:
                per_process_io = True
                read_rate = max(0, end_io[0] - start_io[0]) / rates_elapsed
                write_rate = max(0, end_io[1] - start_io[1]) / rates_elapsed
            key = secrets.token_hex(12)
            row = {"process_id": key, "pid": p.pid, "name": rec["name"], "status": state,
                   "cpu_one_core_percent": round(cpu, 1), "cpu_machine_percent": round(cpu / cores, 1),
                   "rss_bytes": rss, "read_bytes_per_second": read_rate,
                   "write_bytes_per_second": write_rate, "action": action}
            public.append(row)
            private[key] = info
        except PROCESS_ERRORS:
            unreadable += 1
    # Include both CPU and memory leaders, then fill in CPU order.
    leaders = sorted(public, key=lambda r: r["cpu_one_core_percent"], reverse=True)[:max(3, limit * 2 // 3)]
    leaders += sorted(public, key=lambda r: r["rss_bytes"], reverse=True)[:max(2, limit // 3)]
    selected = {r["process_id"]: r for r in leaders}
    for row in sorted(public, key=lambda r: r["cpu_one_core_percent"], reverse=True):
        if len(selected) >= limit:
            break
        selected.setdefault(row["process_id"], row)
    rows = sorted(selected.values(), key=lambda r: r["cpu_one_core_percent"], reverse=True)[:limit]
    mem, swap = psutil.virtual_memory(), psutil.swap_memory()
    root = Path.home().anchor or "/"
    disk, disk_end, net_end = psutil.disk_usage(root), psutil.disk_io_counters(), psutil.net_io_counters()
    def rate(a, b, field):
        return max(0, getattr(b, field) - getattr(a, field)) / rates_elapsed if a and b else None
    report = {
        "snapshot_id": secrets.token_hex(16), "measured_at": now_iso(),
        "sample_seconds": round(time.monotonic() - started, 2), "platform": platform.system(),
        "cpu": {"logical_cores": cores, "samples_percent": cpu_samples,
                "average_percent": round(sum(cpu_samples) / len(cpu_samples), 1)},
        "memory": {"total_bytes": mem.total, "available_bytes": mem.available,
                   "available_percent": round(mem.available / mem.total * 100, 1),
                   "used_percent": mem.percent, "swap_used_bytes": swap.used,
                   "swap_growth_bytes": max(0, swap.used - swap_start)},
        "disk": {"total_bytes": disk.total, "free_bytes": disk.free,
                 "free_percent": round(disk.free / disk.total * 100, 1),
                 "read_bytes_per_second": rate(disk_start, disk_end, "read_bytes"),
                 "write_bytes_per_second": rate(disk_start, disk_end, "write_bytes")},
        "network": {"received_bytes_per_second": rate(net_start, net_end, "bytes_recv"),
                    "sent_bytes_per_second": rate(net_start, net_end, "bytes_sent")},
        "processes": rows, "processes_seen": len(public), "unreadable_or_exited": unreadable,
        "capabilities": {"per_process_io": per_process_io, "native_memory_pressure": False,
                         "gpu": False, "temperature": False, "malware_scan": False},
        "limits": ["Короткий замер не доказывает длительную перегрузку.",
                   "Нагрузка сама по себе не является признаком вируса.",
                   "RSS отдельных процессов может включать общую память; суммы не равны занятой RAM.",
                   "Температура, GPU, состояние диска и содержимое файлов не проверяются.",
                   "Процессы, появившиеся во время замера, попадут в следующий замер."],
    }
    report["findings"] = recommendations(report)
    report["severity"] = "high" if any(f["level"] == "high" for f in report["findings"]) else "watch" if any(f["level"] == "watch" for f in report["findings"]) else "normal"
    return report, {r["process_id"]: private[r["process_id"]] for r in rows}


class Session:
    def __init__(self, clock=time.monotonic, process_factory=psutil.Process, classifier=policy, closer=request_close):
        self.clock, self.process_factory, self.classifier = clock, process_factory, classifier
        self.closer = closer
        self.snapshots, self.proposals = {}, {}

    def prune(self):
        now = self.clock()
        self.snapshots = {k: v for k, v in self.snapshots.items() if now - v["time"] <= 120}
        for item in self.proposals.values():
            if item["status"] == "awaiting_local_confirmation" and now > item["deadline"]:
                item["status"] = "expired"
        self.proposals = {k: v for k, v in self.proposals.items() if now - v["time"] <= 600}

    def remember(self, report, private):
        self.prune()
        self.snapshots[report["snapshot_id"]] = {"time": self.clock(), "report": report, "private": private}
        while len(self.snapshots) > 4:
            del self.snapshots[next(iter(self.snapshots))]
        return report

    def get_report(self, snapshot_id):
        self.prune()
        if snapshot_id not in self.snapshots:
            raise ValueError("Замер устарел или неизвестен. Запустите диагностику заново.")
        return self.snapshots[snapshot_id]["report"]

    def validate(self, expected):
        proc = self.process_factory(expected["pid"])
        live = identity(proc)
        if live != expected:
            raise ValueError("Процесс изменился или PID был использован повторно. Нужен новый замер.")
        parents = {os.getpid(), os.getppid()}
        try:
            parents.update(p.pid for p in psutil.Process().parents())
        except PROCESS_ERRORS:
            pass
        decision = self.classifier(live, protected_pids=parents)
        if decision["mode"] != "confirm":
            raise ValueError(decision["reason"])
        return proc

    def prepare(self, snapshot_id, process_id):
        self.get_report(snapshot_id)
        snap = self.snapshots[snapshot_id]
        expected = snap["private"].get(process_id)
        if not expected:
            raise ValueError("Процесс отсутствует в указанном замере.")
        self.validate(expected)
        self.prune()
        for proposal in self.proposals.values():
            if proposal["identity"] == expected and proposal["status"] == "awaiting_local_confirmation":
                return self.public_proposal(proposal)
        if len(self.proposals) >= 16:
            raise ValueError("Слишком много запросов. Дождитесь истечения существующих.")
        key = secrets.token_hex(16)
        item = {"proposal_id": key, "identity": expected, "time": self.clock(),
                "deadline": self.clock() + 60, "status": "awaiting_local_confirmation"}
        self.proposals[key] = item
        return self.public_proposal(item)

    def public_proposal(self, item):
        return {"proposal_id": item["proposal_id"], "pid": item["identity"]["pid"],
                "name": item["identity"]["name"], "status": item["status"],
                "seconds_remaining": max(0, round(item["deadline"] - self.clock())),
                "warning": "Сохраните работу. В macOS отправляется SIGTERM; в Windows — обычный запрос закрытия окна. Подтвердите лично в локальной панели.",
                "outcome": item.get("outcome")}

    def status(self, proposal_id):
        self.prune()
        if proposal_id not in self.proposals:
            raise ValueError("Запрос не найден или устарел.")
        return self.public_proposal(self.proposals[proposal_id])

    def pending(self):
        self.prune()
        return [self.public_proposal(p) for p in self.proposals.values() if p["status"] == "awaiting_local_confirmation"]

    def execute(self, proposal_id, confirmation):
        self.status(proposal_id)
        item = self.proposals[proposal_id]
        if item["status"] != "awaiting_local_confirmation":
            raise ValueError("Запрос уже использован или истёк.")
        if confirmation != item["identity"]["name"]:
            raise ValueError("Для подтверждения введите точное имя приложения.")
        # Consume before validation/signal; any uncertain outcome requires a new scan.
        item["status"] = "checking"
        try:
            proc = self.validate(item["identity"])
            self.closer(proc)  # No forced kill, no process-tree kill, no privilege elevation.
            item["status"] = "signal_sent"
            try:
                proc.wait(timeout=3)
                item["status"] = "exited"
                item["outcome"] = "Выбранный процесс завершён. Повторите диагностику для проверки эффекта."
            except psutil.TimeoutExpired:
                item["status"] = "still_running"
                item["outcome"] = "Сигнал отправлен, процесс ещё работает. Принудительное завершение не выполнялось."
        except (ValueError, *PROCESS_ERRORS):
            item["status"] = "failed"
            raise
        return self.public_proposal(item)
