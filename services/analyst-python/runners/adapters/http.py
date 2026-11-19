"""Client HTTP minimal (stdlib), cu reîncercări, backoff și limitare de rată — fără dependențe."""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "radarcry-runners/1.0 (+https://hdmihai.github.io/radarcry/)"


class RateLimiter:
    """Cel mult `rate` cereri pe secundă, partajat între fire."""

    def __init__(self, rate: float):
        self.interval = 1.0 / rate if rate > 0 else 0.0
        self.lock = threading.Lock()
        self.next = 0.0

    def wait(self) -> None:
        if not self.interval:
            return
        with self.lock:
            now = time.monotonic()
            if self.next > now:
                time.sleep(self.next - now)
                now = self.next
            self.next = now + self.interval


class HttpClient:
    def __init__(self, rate: float = 8.0, timeout: float = 20.0, retries: int = 3, headers: dict | None = None):
        self.limiter = RateLimiter(rate)
        self.timeout = timeout
        self.retries = retries
        self.headers = {"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})}
        self.calls = 0
        self.errors = 0

    def get_json(self, url: str, params: dict | None = None):
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            self.limiter.wait()
            self.calls += 1
            try:
                req = urllib.request.Request(url, headers=self.headers)
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    return json.loads(res.read().decode("utf-8"))
            except urllib.error.HTTPError as err:
                last = err
                if err.code in (400, 404):
                    break  # perechea/contractul nu există — nu are rost să reîncercăm
                if err.code == 429:
                    time.sleep(min(30.0, 3.0 * (attempt + 1)))
                    continue
                time.sleep(0.6 * (attempt + 1))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as err:
                last = err
                time.sleep(0.6 * (attempt + 1))
        self.errors += 1
        raise RuntimeError(f"GET {url.split('?')[0]}: {last}")
