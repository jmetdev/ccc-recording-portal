from __future__ import annotations

import json
import os
import time

SESSION_ID = "d3dd31"
LOG_PATH = os.environ.get("DEBUG_LOG_PATH", "/recordings/.debug-d3dd31.log")


def debug_log(
    location: str,
    message: str,
    *,
    data: dict | None = None,
    hypothesis_id: str | None = None,
    run_id: str = "pre-fix",
) -> None:
    # #region agent log
    try:
        payload = {
            "sessionId": SESSION_ID,
            "timestamp": int(time.time() * 1000),
            "location": location,
            "message": message,
            "data": data or {},
            "hypothesisId": hypothesis_id,
            "runId": run_id,
        }
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except OSError:
        pass
    # #endregion
