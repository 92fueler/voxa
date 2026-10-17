import asyncio
from collections import OrderedDict
from dataclasses import dataclass

from .util import encode, now_ms


@dataclass
class Task:
    operation: str
    value: object
    size: int
    first_attempt: int


class SaveQueue:
    def __init__(self, write, max_tasks=256, max_bytes=2000000, retry_seconds=0.25, max_age_ms=30000):
        self.write, self.max_tasks, self.max_bytes = write, max_tasks, max_bytes
        self.retry_seconds, self.max_age_ms = retry_seconds, max_age_ms
        self.tasks = OrderedDict()
        self.bytes = 0
        self.gap = self.disposed = False
        self.state = "saved"
        self.worker = None

    def enqueue(self, key, operation, value):
        if self.disposed:
            return
        size = len(encode(value).encode())
        old = self.tasks.get(key)
        total = self.bytes - (old.size if old else 0) + size
        if old is None and len(self.tasks) >= self.max_tasks or total > self.max_bytes:
            self.mark_gap()
            return
        self.bytes = total
        self.tasks[key] = Task(operation, value, size, old.first_attempt if old else now_ms())
        if self.state != "delayed":
            self.state = "incomplete" if self.gap else "saving"
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self._pump())

    def mark_gap(self):
        self.gap, self.state = True, "incomplete"

    async def _pump(self):
        retries = 0
        while self.tasks and not self.disposed:
            key, task = next(iter(self.tasks.items()))
            try:
                async with asyncio.timeout(5):
                    await self.write(task.operation, task.value)
                if self.tasks.get(key) is task:
                    del self.tasks[key]
                    self.bytes -= task.size
                retries = 0
            except Exception:
                self.state = "incomplete" if self.gap else "delayed"
                if now_ms() - task.first_attempt >= self.max_age_ms:
                    self.mark_gap()
                    self.disposed = True
                    self.tasks.clear()
                    self.bytes = 0
                    return
                await asyncio.sleep(min(5, self.retry_seconds * 2 ** min(retries, 5)))
                retries += 1
        if not self.disposed:
            self.state = "incomplete" if self.gap else "saved"

    @property
    def pending(self):
        return len(self.tasks)

    async def flush(self, timeout=5):
        if self.worker:
            try:
                await asyncio.wait_for(asyncio.shield(self.worker), timeout)
            except (TimeoutError, asyncio.CancelledError):
                pass

    def dispose(self):
        self.disposed = True
        if self.worker:
            self.worker.cancel()
        self.tasks.clear()
        self.bytes = 0
