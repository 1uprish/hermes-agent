"""A real Electron app mapping the live release, with its cwd in that tree."""
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
HOME = Path(tempfile.mkdtemp(prefix='electron-lock-'))
os.environ.update(HOME=str(HOME), USERPROFILE=str(HOME), HERMES_HOME=str(HOME))
from hermes_cli.main_desktop import _swap_staged_desktop_app

out = ROOT / 'windows-evidence'
desktop = HOME / 'apps/desktop'
live = desktop / 'release/win-unpacked'
electron_package = Path(subprocess.check_output(['node', '-p', "require.resolve('electron/package.json')"], cwd=ROOT / 'apps/desktop', stdin=subprocess.DEVNULL, text=True).strip()).parent
if not (electron_package / 'dist/electron.exe').is_file():
    subprocess.run(['node', str(electron_package / 'install.js')], cwd=electron_package, stdin=subprocess.DEVNULL, check=True, timeout=120)
electron_dist = electron_package / 'dist'
shutil.copytree(electron_dist, live)
(live / 'electron.exe').rename(live / 'Hermes.exe')
app = HOME / 'fixture.cjs'
ready = HOME / 'ready'
app.write_text("const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>{const w=new BrowserWindow({show:false});require('fs').writeFileSync(process.argv[2],'ready');setInterval(()=>{},1000)});", encoding='utf-8')
stage = desktop / '.staging-probe'
shutil.copytree(live, stage / 'win-unpacked')
(stage / 'win-unpacked/new-generation').touch()
p = subprocess.Popen([str(live / 'Hermes.exe'), str(app), str(ready), '--user-data-dir='+str(HOME / 'electron-profile')], cwd=live, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    deadline = time.monotonic() + 30
    while not ready.exists() and p.poll() is None and time.monotonic() < deadline:
        time.sleep(.1)
    if not ready.exists(): raise RuntimeError(f'Electron did not become ready, exit={p.poll()}')
    premise = False
    error = None
    try:
        os.rename(live, live.with_name('premise'))
        os.rename(live.with_name('premise'), live)
    except OSError as exc:
        premise, error = True, str(exc)
    promoted = _swap_staged_desktop_app(desktop, stage)
    result = dict(electron_ready=True, real_lock_confirmed=premise, lock_error=error, promoted=str(promoted), new_generation=(live / 'new-generation').exists(), locker_alive=p.poll() is None, old_executable_preserved=(live / 'Hermes.exe').exists())
    (out / 'electron-lock.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result), flush=True)
finally:
    subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], stdin=subprocess.DEVNULL, capture_output=True, check=False)
    p.wait(timeout=15)
