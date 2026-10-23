"""Private line-delimited JSON IPC. Only the local controller can call execute."""
import json
import sys
from core import Session, sample, PROCESS_ERRORS

# Node's child-process pipes carry UTF-8 JSON. Windows may otherwise select a
# legacy code page for redirected stdio, which cannot encode Russian responses.
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

session = Session()

def dispatch(op, args):
    if op == "diagnose":
        report, private = sample(args.get("seconds", 3), args.get("limit", 25))
        return session.remember(report, private)
    if op == "report":
        return session.get_report(args["snapshot_id"])
    if op == "prepare":
        return session.prepare(args["snapshot_id"], args["process_id"])
    if op == "status":
        return session.status(args["proposal_id"])
    if op == "pending":
        return session.pending()
    if op == "execute":
        return session.execute(args["proposal_id"], args["confirmation"])
    raise ValueError("Неизвестная операция.")

for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        result = dispatch(request["op"], request.get("args", {}))
        response = {"id": request["id"], "result": result}
    except (ValueError, KeyError, TypeError, *PROCESS_ERRORS) as exc:
        response = {"id": request.get("id"), "error": str(exc)}
    except Exception:
        response = {"id": request.get("id"), "error": "Диагностика недоступна: внутренняя ошибка агента."}
    print(json.dumps(response, ensure_ascii=False), flush=True)
