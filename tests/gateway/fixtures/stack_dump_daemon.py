"""Ordinary daemon plus delayed diagnostics (native-runner readiness stalls only).

No behaviour change: after ``UGW_STACK_DUMP_AFTER`` seconds every OS thread's stack
(faulthandler) and every asyncio task's coroutine stack are appended to
``$HERMES_HOME/logs/stacks.txt`` so a stall on a runner without SIGUSR2/strace still
names the awaiting frame.
"""
import asyncio
import faulthandler
import os
from pathlib import Path
import runpy

path = Path(os.environ['HERMES_HOME']) / 'logs' / 'stacks.txt'
path.parent.mkdir(parents=True, exist_ok=True)
delay = float(os.environ.get('UGW_STACK_DUMP_AFTER', '60'))
_sink = open(path, 'w', encoding='utf-8')  # noqa: SIM115 - must outlive the dump
faulthandler.dump_traceback_later(delay, repeat=False, file=_sink)
_real_run = asyncio.run


def _run(main, **kwargs):
    async def wrapped():
        loop = asyncio.get_running_loop()

        def dump_tasks():
            with open(path, 'a', encoding='utf-8') as sink:
                sink.write('\n=== asyncio tasks ===\n')
                for task in asyncio.all_tasks(loop):
                    sink.write(f'\n--- {task.get_name()} done={task.done()} ---\n')
                    task.print_stack(file=sink)
        loop.call_later(delay + 1, dump_tasks)
        return await main
    return _real_run(wrapped(), **kwargs)


asyncio.run = _run
runpy.run_module('gateway.run', run_name='__main__')
