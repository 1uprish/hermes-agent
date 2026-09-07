"""Real Windows handoff with controlled updater children (not AV/full updater)."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'windows-evidence'
OUT.mkdir(exist_ok=True)
HOME = Path(tempfile.mkdtemp(prefix='receipt-matrix-'))
os.environ.update(HOME=str(HOME), USERPROFILE=str(HOME), HERMES_HOME=str(HOME))
sys.path.insert(0, str(ROOT))
from hermes_cli.main_desktop import _compute_desktop_content_hash

shell = str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
rows = []
for mode in ['healthy', 'missing-exe', 'corrupt-exe', 'missing-asar', 'missing-index', 'missing-chunk', 'missing-stamp', 'stale-stamp', 'missing-python', 'dependency-recovery', 'refused']:
    install = HOME / mode / 'repo'
    install.mkdir(parents=True)
    env = dict(os.environ, HERMES_HOME=str(install.parent), PYTHONPATH=str(ROOT))
    subprocess.run([sys.executable, '-m', 'venv', '--system-site-packages', str(install / 'venv')], stdin=subprocess.DEVNULL, check=True)
    package = install / 'hermes_cli'
    package.mkdir()
    (package / '__init__.py').write_text(f'__path__.append({str(ROOT / "hermes_cli")!r})\n', encoding='utf-8')
    (package / 'main.py').write_text("import sys\nfrom pathlib import Path\nif '--help' in sys.argv: print('--keep-stash')\nelif 'update' in sys.argv:\n Path('update-ran').touch()\n" + (" raise SystemExit(2)\n" if mode == 'refused' else " Path('dependency-broken').unlink(missing_ok=True)\n") + "elif Path('dependency-broken').exists(): raise ImportError('controlled pre-update dependency failure')\n", encoding='utf-8')
    desktop = install / 'apps/desktop'
    live = desktop / 'release/win-unpacked'
    dist = live / 'resources/app.asar.unpacked/dist'
    (dist / 'assets').mkdir(parents=True)
    shutil.copy2(Path(os.environ['SystemRoot']) / 'System32/cmd.exe', live / 'Hermes.exe')
    (live / 'resources/app.asar').write_bytes(b'controlled artifact fixture, not launchable Electron app')
    (dist / 'index.html').write_text('<script type="module" src="./assets/index.js"></script>', encoding='utf-8')
    (dist / 'assets/index.js').write_text('export {}', encoding='utf-8')
    (install / '.gitignore').write_text('apps/desktop/release/\n', encoding='utf-8')
    stamp = install.parent / 'desktop-build-stamp.json'
    stamp.write_text(json.dumps(dict(contentHash=_compute_desktop_content_hash(install), sourceMode=False)), encoding='utf-8')
    removals = {'missing-exe': live / 'Hermes.exe', 'missing-asar': live / 'resources/app.asar', 'missing-index': dist / 'index.html', 'missing-chunk': dist / 'assets/index.js', 'missing-stamp': stamp, 'missing-python': install / 'venv/Scripts/python.exe'}
    if mode in removals: removals[mode].unlink()
    if mode == 'corrupt-exe': (live / 'Hermes.exe').write_bytes(b'MZbroken')
    if mode == 'stale-stamp': stamp.write_text('{"contentHash":"old", "sourceMode":false}', encoding='utf-8')
    if mode == 'dependency-recovery': (install / 'dependency-broken').touch()
    args = [shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'scripts/desktop-update/windows.ps1'), '-InstallRoot', str(install), '-NoUi']
    # A still-live Desktop sentinel proves prerequisites run before the wait gate.
    if mode == 'missing-python': args += ['-DesktopPid', str(os.getpid())]
    p = subprocess.run(args, cwd=install, env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=95)
    (OUT / f'matrix-{mode}.log').write_bytes(p.stdout + p.stderr)
    receipt_path = install.parent / '.hermes-update-result.json'
    receipt = json.loads(receipt_path.read_text(encoding='utf-8-sig')) if receipt_path.exists() else None
    expected = 0 if mode in ['healthy', 'dependency-recovery'] else 2 if mode == 'refused' else 3 if mode == 'missing-python' else 8
    row = dict(mode=mode, exit=p.returncode, expected=expected, receipt=receipt, update_ran=(install / 'update-ran').exists(), passed=p.returncode == expected and receipt is not None and receipt['ok'] == (expected == 0))
    rows.append(row)
    (OUT / 'receipt-matrix.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
    print(json.dumps(row), flush=True)
# Observation mode for A/B: failed invariants are recorded, not hidden by job status.
