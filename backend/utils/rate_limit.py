"""Tiny in-memory limiter used to slow down password guessing on /api/auth/login."""

import threading
import time


class FailureLimiter:
    """Allows `max_failures` failures per key inside a sliding `window` (seconds)."""

    def __init__(self, max_failures, window):
        self.max_failures = max_failures
        self.window = window
        self._failures = {}
        self._lock = threading.Lock()

    def _recent(self, key, now):
        recent = [t for t in self._failures.get(key, []) if now - t < self.window]
        if recent:
            self._failures[key] = recent
        else:
            self._failures.pop(key, None)
        return recent

    def retry_after(self, key):
        """Seconds until this key may try again (0 if it is not locked)."""
        now = time.monotonic()
        with self._lock:
            recent = self._recent(key, now)
            if len(recent) < self.max_failures:
                return 0
            return max(1, int(self.window - (now - recent[0])))

    def record_failure(self, key):
        now = time.monotonic()
        with self._lock:
            self._recent(key, now)
            self._failures.setdefault(key, []).append(now)

    def reset(self, key):
        with self._lock:
            self._failures.pop(key, None)