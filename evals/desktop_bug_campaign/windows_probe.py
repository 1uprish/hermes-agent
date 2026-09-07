"""Native Windows mechanism probes; never writes to an installed Hermes tree."""
import concurrent.futures
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
OUT = ROOT / 'windows-evidence'
OUT.mkdir(exist_ok=True)
HOME = Path(tempfile.mkdtemp(prefix='hermes-windows-probe-'))
os.environ['HERMES_HOME'] = str(HOME)
results = []


def record(name, **data):
    results.append(dict(name=name, **data))
    (OUT / 'mechanisms.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results[-1]), flush=True)


def progress():
    from hermes_cli.main_dashboard import _install_hangup_protection, _finalize_update_output, _UpdateOutputStream
    from hermes_cli.update_cmd import _run_logged_subprocess
    state = _install_hangup_protection(gateway_mode=True)
    try:
        print('gateway witness', flush=True)
        installed = state['installed']
    finally:
        _finalize_update_output(state)
    record('gateway_mirror', installed=installed, log_exists=(HOME / 'logs/update.log').exists())
    log_path = HOME / 'stream.log'
    release = HOME / 'release-child'
    child = "import pathlib,sys,time; print('building',flush=True); p=pathlib.Path(sys.argv[1]); deadline=time.monotonic()+15\nwhile not p.exists() and time.monotonic()<deadline: time.sleep(.02)\nprint('finished',flush=True)"
    terminal = io.StringIO()
    old = sys.stdout
    with log_path.open('w', encoding='utf-8') as log, concurrent.futures.ThreadPoolExecutor(1) as pool:
        sys.stdout = _UpdateOutputStream(terminal, log)
        fut = pool.submit(_run_logged_subprocess, [sys.executable, '-u', '-c', child, str(release)], cwd=HOME)
        try:
            deadline = time.monotonic() + 4
            while 'building' not in log_path.read_text(encoding='utf-8') and time.monotonic() < deadline:
                time.sleep(.02)
            before = log_path.read_text(encoding='utf-8')
            alive = not fut.done()
        finally:
            release.touch()
            result = fut.result(timeout=20)
            sys.stdout = old
    record('stream_before_exit', progress_before_exit='building' in before, child_alive=alive, exit=result.returncode, terminal=terminal.getvalue(), full_log=log_path.read_text(encoding='utf-8'))


def promotion():
    from hermes_cli.main_desktop import _swap_staged_desktop_app
    desktop = HOME / 'promotion/apps/desktop'
    live = desktop / 'release/win-unpacked'
    live.mkdir(parents=True)
    exe = live / 'Hermes.exe'
    shutil.copy2(Path(os.environ['SystemRoot']) / 'System32/cmd.exe', exe)
    stage = desktop / '.staging-probe'
    (stage / 'win-unpacked').mkdir(parents=True)
    shutil.copy2(exe, stage / 'win-unpacked/Hermes.exe')
    (stage / 'win-unpacked/new-generation').touch()
    p = subprocess.Popen([str(exe), '/d', '/c', 'ping -n 40 127.0.0.1 > nul'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1)
        if p.poll() is not None:
            raise RuntimeError('locker failed to start')
        premise = False
        try:
            os.rename(live, live.with_name('premise'))
            os.rename(live.with_name('premise'), live)
        except PermissionError:
            premise = True
        promoted = _swap_staged_desktop_app(desktop, stage)
        record('promotion_lock', real_lock_confirmed=premise, promoted=str(promoted), new_generation=(live / 'new-generation').exists(), locker_alive=p.poll() is None)
    finally:
        subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], stdin=subprocess.DEVNULL, capture_output=True, check=False)
        p.wait(timeout=10)


def powershell_missing():
    shell = str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
    fixture = HOME / 'missing-forwarder'
    fixture.mkdir()
    shutil.copy2(ROOT / 'scripts/desktop-update.ps1', fixture / 'desktop-update.ps1')
    p = subprocess.run([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(fixture / 'desktop-update.ps1'), '-InstallRoot', str(fixture / 'repo'), '-NoUi'], stdin=subprocess.DEVNULL, capture_output=True, timeout=60)
    (OUT / 'missing-forwarder.log').write_bytes(p.stdout + p.stderr)
    record('missing_forwarder_target', exit=p.returncode)
    install = HOME / 'missing-python/repo'
    install.mkdir(parents=True)
    p = subprocess.run([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'scripts/desktop-update/windows.ps1'), '-InstallRoot', str(install), '-NoUi'], stdin=subprocess.DEVNULL, capture_output=True, timeout=90)
    (OUT / 'missing-python.log').write_bytes(p.stdout + p.stderr)
    receipt = install.parent / '.hermes-update-result.json'
    record('missing_python', exit=p.returncode, receipt=json.loads(receipt.read_text(encoding='utf-8-sig')) if receipt.exists() else None)


def false_success():
    # Controlled update child, not the real updater: isolates the PowerShell receipt boundary.
    shell = str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
    install = HOME / 'false-success/repo'
    install.mkdir(parents=True)
    subprocess.run([sys.executable, '-m', 'venv', str(install / 'venv')], stdin=subprocess.DEVNULL, check=True)
    package = install / 'hermes_cli'
    package.mkdir()
    (package / '__init__.py').touch()
    (package / 'main.py').write_text("import sys\nfrom pathlib import Path\nif '--help' in sys.argv: print('--keep-stash')\nelif 'update' in sys.argv:\n print('Controlled child completed; no desktop artifact produced', flush=True)\n Path(__file__).unlink()\n", encoding='utf-8')
    p = subprocess.run([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'scripts/desktop-update/windows.ps1'), '-InstallRoot', str(install), '-NoUi'], cwd=install, stdin=subprocess.DEVNULL, capture_output=True, timeout=90)
    (OUT / 'false-success.log').write_bytes(p.stdout + p.stderr)
    receipt = install.parent / '.hermes-update-result.json'
    record('false_success_boundary', fidelity='real maintained PowerShell script; controlled zero-exit update child deletes its module; not full update', exit=p.returncode, module_exists=(package / 'main.py').exists(), desktop_exists=(install / 'apps/desktop/release').exists(), receipt=json.loads(receipt.read_text(encoding='utf-8-sig')) if receipt.exists() else None)


def watchdog():
    shell = str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
    env = dict(os.environ, HERMES_UPDATE_STEP_IDLE_SECONDS='3', HERMES_SELFTEST_HOLD_SECONDS='20', HERMES_SELFTEST_FLOOD_KB='128')
    p = subprocess.run([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'scripts/desktop-update/windows.ps1'), '-InstallRoot', str(HOME / 'watchdog/repo'), '-SelfTestPipeDrain', '-NoUi'], env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=90)
    (OUT / 'watchdog.log').write_bytes(p.stdout + p.stderr)
    record('watchdog_native_selftest', exit=p.returncode, output_tail=(p.stdout + p.stderr).decode('utf-8', errors='replace')[-2500:])


if sys.platform != 'win32':
    raise SystemExit('Native Windows required')
for probe in [progress, promotion, powershell_missing, false_success, watchdog]:
    try:
        probe()
    except Exception as exc:
        import traceback
        record(probe.__name__, error=str(exc), traceback=traceback.format_exc())
