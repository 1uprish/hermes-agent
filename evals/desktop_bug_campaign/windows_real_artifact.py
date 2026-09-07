"""Ephemeral native A/B: real packaged Hermes, controlled updater child."""
import ctypes
from ctypes import wintypes
import hashlib
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
HOME = Path(tempfile.mkdtemp(prefix='real-artifact-'))
os.environ.update(HOME=str(HOME), USERPROFILE=str(HOME), HERMES_HOME=str(HOME))
sys.path.insert(0, str(ROOT))
from hermes_cli.main_desktop import _compute_desktop_content_hash

source = ROOT / 'apps/desktop/release/win-unpacked'
assert (source / 'Hermes.exe').stat().st_size > 100_000_000
assert (source / 'resources/app.asar.unpacked/dist/electron-main.mjs').stat().st_size > 100_000
identity = {str(p.relative_to(source)): dict(bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in [source / 'Hermes.exe', source / 'resources/app.asar', source / 'resources/app.asar.unpacked/dist/electron-main.mjs', source / 'resources/app.asar.unpacked/dist/index.html']}
(OUT / 'packaged-identity.json').write_text(json.dumps(identity, indent=2), encoding='utf-8')
old = subprocess.check_output(['git', 'show', '583bb7d84df:hermes_cli/desktop_update_verify.py'])
new = (ROOT / 'hermes_cli/desktop_update_verify.py').read_bytes()
shell = str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
rows = []
install = HOME / 'repo'
install.mkdir()
subprocess.run([sys.executable, '-m', 'venv', '--system-site-packages', str(install / 'venv')], stdin=subprocess.DEVNULL, check=True)
package = install / 'hermes_cli'
package.mkdir()
(package / '__init__.py').write_text(f'__path__.append({str(ROOT / "hermes_cli")!r})\n', encoding='utf-8')
(package / 'main.py').write_text("import sys\nfrom pathlib import Path\nif '--help' in sys.argv: print('--keep-stash')\nelif 'update' in sys.argv:\n Path('update-ran').touch()\n if Path('refused').exists(): raise SystemExit(2)\n Path('dependency-broken').unlink(missing_ok=True)\nelif Path('dependency-broken').exists(): raise ImportError('controlled repair needed')\n", encoding='utf-8')
live = install / 'apps/desktop/release/win-unpacked'
shutil.copytree(source, live)
(install / '.gitignore').write_text('apps/desktop/release/\n', encoding='utf-8')
(HOME / 'desktop-build-stamp.json').write_text(json.dumps(dict(contentHash=_compute_desktop_content_hash(install), sourceMode=False)), encoding='utf-8')
targets = {'corrupt-asar': live / 'resources/app.asar', 'empty-index': live / 'resources/app.asar.unpacked/dist/index.html', 'unreadable-index': live / 'resources/app.asar.unpacked/dist/index.html', 'empty-main': live / 'resources/app.asar.unpacked/dist/electron-main.mjs'}
targets['locked-index'] = live / 'resources/app.asar.unpacked/dist/index.html'
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
kernel.CreateFileW.restype = wintypes.HANDLE
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
for leg, code in [('before', old), ('after', new)]:
    (package / 'desktop_update_verify.py').write_bytes(code)
    shutil.rmtree(package / '__pycache__', ignore_errors=True)
    for mode in ['packaged-positive', *targets, 'dependency-recovery', 'refused']:
        target = targets.get(mode)
        saved = target.read_bytes() if target else None
        handle = None
        if mode == 'locked-index':
            handle = kernel.CreateFileW(str(target), 0x80000000, 0, None, 3, 0x80, None)
            assert handle not in (None, ctypes.c_void_p(-1).value), ctypes.get_last_error()
            try:
                target.read_bytes()
            except PermissionError:
                pass
            else:
                raise AssertionError('exclusive index lock did not deny reads')
        elif target:
            target.write_bytes(b'bad asar' if mode == 'corrupt-asar' else b'\xff' if mode == 'unreadable-index' else b'')
        if mode == 'dependency-recovery': (install / 'dependency-broken').touch()
        if mode == 'refused': (install / 'refused').touch()
        (install / 'update-ran').unlink(missing_ok=True)
        receipt_path = HOME / '.hermes-update-result.json'
        receipt_path.unlink(missing_ok=True)
        p = subprocess.run([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'scripts/desktop-update/windows.ps1'), '-InstallRoot', str(install), '-NoUi'], cwd=install, env=dict(os.environ, PYTHONPATH=str(ROOT)), stdin=subprocess.DEVNULL, capture_output=True, timeout=95)
        (OUT / f'real-{leg}-{mode}.log').write_bytes(p.stdout + p.stderr)
        receipt = json.loads(receipt_path.read_text(encoding='utf-8-sig')) if receipt_path.exists() else None
        expected = 2 if mode == 'refused' else 8 if target and leg == 'after' else 0
        rows.append(dict(leg=leg, mode=mode, exit=p.returncode, receipt=receipt, expected=expected, update_ran=(install / 'update-ran').exists(), passed=p.returncode == expected and receipt is not None and receipt['ok'] == (expected == 0)))
        (OUT / 'real-artifact-matrix.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
        print(json.dumps(rows[-1]), flush=True)
        if handle is not None: kernel.CloseHandle(handle)
        if target:
            assert saved is not None
            target.write_bytes(saved)
        (install / 'refused').unlink(missing_ok=True)
assert len(rows) == 16 and all(r['passed'] for r in rows)
