"""Ordinary daemon plus a delayed all-thread stack dump (native-runner diagnostics only).

No behaviour change: after ``UGW_STACK_DUMP_AFTER`` seconds every thread's stack is
written to ``$HERMES_HOME/logs/stacks.txt`` so a readiness stall on a runner without
SIGUSR2/strace still names the exact awaiting frame.
"""
import faulthandler
import os
from pathlib import Path
import runpy

path = Path(os.environ['HERMES_HOME']) / 'logs' / 'stacks.txt'
path.parent.mkdir(parents=True, exist_ok=True)
_sink = open(path, 'w', encoding='utf-8')  # noqa: SIM115 - must outlive the dump
faulthandler.dump_traceback_later(float(os.environ.get('UGW_STACK_DUMP_AFTER', '60')), repeat=False, file=_sink)
runpy.run_module('gateway.run', run_name='__main__')
