from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from threading import Lock
from typing import Callable


class AuditJobQueue:
    def __init__(self, max_workers: int = 2) -> None:
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="auditai")
        self._futures: dict[str, Future] = {}
        self._lock = Lock()

    def enqueue(self, audit_id: str, fn: Callable[[], None]) -> Future:
        with self._lock:
            future = self.executor.submit(fn)
            self._futures[audit_id] = future
            return future

    def is_running(self, audit_id: str) -> bool:
        with self._lock:
            future = self._futures.get(audit_id)
            return future is not None and not future.done()

    def get_future(self, audit_id: str) -> Future | None:
        with self._lock:
            return self._futures.get(audit_id)
