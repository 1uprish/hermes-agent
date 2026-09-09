"""TEMPORARY CI shim for the unified gateway native proof (never merges).

Runs the live suite with captured output so a wide pytest log cannot wedge the
runner log pipeline, writes the full log to ``ugw-native-logs/``, and prints ONE
``RESULT <job>: exit=N passed=X failed=Y`` line.
"""
import os
from pathlib import Path
import re
import subprocess
import sys

FILES = [
    "tests/gateway/test_unified_gateway_native_live.py",
    "tests/gateway/test_api_crash_recovery.py",
    "tests/gateway/test_managed_worker_launch.py",
    "tests/gateway/test_used_delete_restart.py",
    "tests/hermes_cli/test_safe_mode.py",
    "tests/gateway/test_session_policy.py",
]


def main() -> int:
    job = os.environ.get("UGW_JOB", sys.platform)
    logs = Path("ugw-native-logs")
    logs.mkdir(exist_ok=True)
    junit = logs / f"junit-{job}.xml"
    command = [sys.executable, "-m", "pytest", *FILES, "-o", "addopts=", "-v", "-rA", "-p", "no:cacheprovider",
               "--junitxml", str(junit)]
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        out, _ = proc.communicate(timeout=1700)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate(timeout=30)
        out += b"\nSHIM: pytest timed out after 1700s\n"
    text = out.decode("utf-8", "replace")
    (logs / f"pytest-{job}.log").write_text(text, encoding="utf-8")
    counts = {k: int(v) for v, k in re.findall(r"(\d+) (passed|failed|error|errors|skipped|deselected)", text[-4000:])}
    failed = counts.get("failed", 0) + counts.get("error", 0) + counts.get("errors", 0)
    # Show failures inline (bounded) so the run page itself names the defect.
    tail = text[-12000:]
    sys.stdout.write(tail + "\n")
    print(f"RESULT {job}: exit={proc.returncode} passed={counts.get('passed', 0)} failed={failed}", flush=True)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
