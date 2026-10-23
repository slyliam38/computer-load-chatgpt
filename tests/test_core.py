import contextlib
import ntpath
import os
import sys
import subprocess
import time
import unittest
from pathlib import Path, PurePosixPath
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent"))
import core
import psutil


class DarwinPath(PurePosixPath):
    @classmethod
    def home(cls):
        return cls("/Users/person")


def info(**changes):
    result = {"pid": 54321, "created": 42.0, "name": "VLC",
              "exe": "/Applications/VLC.app/Contents/MacOS/VLC", "owner": "person"}
    result.update(changes)
    return result


class PolicyTests(unittest.TestCase):
    def classify(self, value, system="Darwin"):
        if system == "Darwin":
            with patch.object(core, "Path", DarwinPath):
                return core.policy(value, owner="person", system=system, protected_pids={777})["mode"]
        return core.policy(value, owner="person", system=system, protected_pids={777})["mode"]

    def test_only_known_media_main_binary_allowed(self):
        self.assertEqual(self.classify(info()), "confirm")
        for value in [info(name="VLC Helper"), info(exe="/tmp/VLC"), info(exe="/Applications/Fake/VLC.app/Contents/MacOS/VLC"), info(exe="")]:
            self.assertNotEqual(self.classify(value), "confirm")

    def test_system_and_other_owner_denied(self):
        for value in [info(pid=1), info(pid=777), info(owner="root"), info(owner="someone"), info(owner="")]:
            self.assertEqual(self.classify(value), "protected")

    def test_business_and_infrastructure_denied(self):
        for name in ["1cv8", "rphost", "postgres", "mysqld", "backupd", "OneDrive", "WindowServer", "AnyDesk", "tunnel-client", "node", "python3"]:
            self.assertEqual(self.classify(info(name=name)), "protected", name)

    def test_unknown_gui_manual(self):
        self.assertEqual(self.classify(info(name="Unknown", exe="/Applications/Unknown.app/Contents/MacOS/Unknown")), "manual")

    def test_windows_exact_media_path(self):
        with patch.dict(os.environ, {"ProgramFiles": r"C:\Program Files", "APPDATA": r"C:\Users\person\AppData\Roaming"}):
            # Windows path construction is host-independent.
            exe = ntpath.join(os.environ["ProgramFiles"], "VideoLAN", "VLC", "vlc.exe")
            self.assertEqual(self.classify(info(name="vlc.exe", exe=exe), "Windows"), "confirm")
            self.assertEqual(self.classify(info(name="VLC.EXE", exe=exe.lower()), "Windows"), "confirm")
            self.assertEqual(self.classify(info(name="vlc.exe", exe="C:/Temp/vlc.exe"), "Windows"), "manual")
            self.assertEqual(self.classify(info(name="sqlservr.exe", exe=exe), "Windows"), "protected")


class FakeProcess:
    def __init__(self, value):
        self.value, self.signals, self.wait_timeout = value, 0, False
        self.pid = value["pid"]
    def oneshot(self): return contextlib.nullcontext()
    def create_time(self): return self.value["created"]
    def name(self): return self.value["name"]
    def exe(self): return self.value["exe"]
    def username(self): return self.value["owner"]
    def is_running(self): return True
    def terminate(self): self.signals += 1
    def wait(self, timeout):
        if self.wait_timeout: raise psutil.TimeoutExpired(timeout, self.pid)
        return 0


class ConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.time = 10
        self.expected = info()
        self.proc = FakeProcess(info())
        self.session = core.Session(clock=lambda: self.time, process_factory=lambda pid: self.proc,
                                    classifier=lambda value, **_: {"mode": "confirm", "reason": "test"},
                                    closer=lambda p: p.terminate())
        self.session.remember({"snapshot_id": "scan"}, {"process": self.expected})

    def test_prepare_does_not_send_signal_and_retries_deduplicate(self):
        first = self.session.prepare("scan", "process")
        second = self.session.prepare("scan", "process")
        self.assertEqual(first["proposal_id"], second["proposal_id"])
        self.assertEqual(self.proc.signals, 0)

    def test_expired_scan_rejected(self):
        self.time += 121
        with self.assertRaises(ValueError): self.session.prepare("scan", "process")
        self.assertEqual(self.proc.signals, 0)

    def test_reused_pid_rejected_at_prepare(self):
        self.proc.value["created"] += 1
        with self.assertRaises(ValueError): self.session.prepare("scan", "process")

    def test_changed_identity_rejected_before_signal(self):
        key = self.session.prepare("scan", "process")["proposal_id"]
        self.proc.value["exe"] = "/tmp/other"
        with self.assertRaises(ValueError): self.session.execute(key, "VLC")
        self.assertEqual(self.proc.signals, 0)
        self.assertEqual(self.session.status(key)["status"], "failed")

    def test_expired_proposal_rejected(self):
        key = self.session.prepare("scan", "process")["proposal_id"]
        self.time += 61
        with self.assertRaises(ValueError): self.session.execute(key, "VLC")
        self.assertEqual(self.proc.signals, 0)

    def test_wrong_confirmation_cannot_signal(self):
        key = self.session.prepare("scan", "process")["proposal_id"]
        with self.assertRaises(ValueError): self.session.execute(key, "yes")
        self.assertEqual(self.proc.signals, 0)

    def test_success_checked_and_cannot_replay(self):
        key = self.session.prepare("scan", "process")["proposal_id"]
        self.assertEqual(self.session.execute(key, "VLC")["status"], "exited")
        with self.assertRaises(ValueError): self.session.execute(key, "VLC")
        self.assertEqual(self.proc.signals, 1)

    def test_unresponsive_process_is_not_force_killed(self):
        self.proc.wait_timeout = True
        key = self.session.prepare("scan", "process")["proposal_id"]
        self.assertEqual(self.session.execute(key, "VLC")["status"], "still_running")
        self.assertEqual(self.proc.signals, 1)

    def test_policy_rechecked_at_confirmation(self):
        key = self.session.prepare("scan", "process")["proposal_id"]
        self.session.classifier = lambda value, **_: {"mode": "protected", "reason": "now protected"}
        with self.assertRaises(ValueError): self.session.execute(key, "VLC")
        self.assertEqual(self.proc.signals, 0)

    def test_disposable_child_runtime_only(self):
        # Sole real signal test: a child created by this test, never user processes.
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        try:
            expected = core.identity(psutil.Process(child.pid))
            session = core.Session(classifier=lambda value, **_: {"mode": "confirm", "reason": "owned test child"}, closer=lambda p: p.terminate())
            session.remember({"snapshot_id": "test"}, {"owned": expected})
            proposal = session.prepare("test", "owned")
            self.assertIsNone(child.poll())
            self.assertEqual(session.execute(proposal["proposal_id"], expected["name"])["status"], "exited")
        finally:
            if child.poll() is None: child.terminate()
            child.wait(timeout=5)


class InterpretationTests(unittest.TestCase):
    def make_report(self):
        return {"cpu": {"samples_percent": [20, 21, 22], "average_percent": 21},
                "memory": {"available_percent": 25, "used_percent": 75, "swap_growth_bytes": 0},
                "disk": {"free_percent": 30}}
    def test_brief_cpu_spike_not_called_sustained(self):
        report = self.make_report(); report["cpu"] = {"samples_percent": [98, 12, 10], "average_percent": 40}
        self.assertFalse(any(f["level"] == "high" for f in core.recommendations(report)))
    def test_cache_or_old_swap_alone_not_critical(self):
        report = self.make_report(); report["memory"]["used_percent"] = 93; report["memory"]["available_percent"] = 7
        self.assertFalse(any(f["level"] == "high" for f in core.recommendations(report)))
    def test_empty_disk_requires_storage_action(self):
        report = self.make_report(); report["disk"]["free_percent"] = 2
        findings = core.recommendations(report)
        self.assertTrue(any(f["level"] == "high" and "диске" in f["title"] for f in findings))
    def test_scan_parameter_bounds(self):
        for seconds in [0, 1, 11, True, 2.5]:
            with self.assertRaises(ValueError): core.sample(seconds=seconds)


class WindowsCloseTests(unittest.TestCase):
    def test_windows_never_uses_terminate_process(self):
        import ctypes
        class Fn:
            def __init__(self, implementation): self.implementation = implementation
            def __call__(self, *args): return self.implementation(*args)
        class WinAPI:
            def __init__(self):
                self.sent = []
                self.EnumWindows = Fn(lambda callback, _: callback(123, 0))
                self.GetWindowThreadProcessId = Fn(lambda hwnd, pointer: setattr(pointer._obj, "value", 54321))
                self.IsWindowVisible = Fn(lambda hwnd: True)
                self.PostMessageW = Fn(lambda *args: self.sent.append(args) or True)
        win = WinAPI()
        proc = FakeProcess(info())
        with patch.object(core.platform, "system", return_value="Windows"), patch.object(ctypes, "WinDLL", return_value=win, create=True), patch.object(ctypes, "WINFUNCTYPE", return_value=lambda fn: fn, create=True):
            core.request_close(proc)
        self.assertEqual(proc.signals, 0)
        self.assertEqual(win.sent[0][1], 0x0010)

    def test_windows_no_window_has_no_forced_fallback(self):
        import ctypes
        class Fn:
            def __call__(self, *args): return True
        class WinAPI:
            EnumWindows = Fn()
            GetWindowThreadProcessId = Fn()
            IsWindowVisible = Fn()
            PostMessageW = Fn()
        proc = FakeProcess(info())
        with patch.object(core.platform, "system", return_value="Windows"), patch.object(ctypes, "WinDLL", return_value=WinAPI(), create=True), patch.object(ctypes, "WINFUNCTYPE", return_value=lambda fn: fn, create=True):
            with self.assertRaises(ValueError): core.request_close(proc)
        self.assertEqual(proc.signals, 0)


if __name__ == "__main__": unittest.main()
