from __future__ import annotations

import os
import wave


def wav_duration_seconds(path: str) -> float | None:
    if not path or not os.path.isfile(path):
        return None
    try:
        with wave.open(path, "rb") as wf:
            rate = wf.getframerate()
            if rate <= 0:
                return None
            return wf.getnframes() / float(rate)
    except (wave.Error, OSError):
        return None


def duration_from_recording_files(recordings_dir: str, files: dict[str, str]) -> float | None:
    best: float | None = None
    for rel in files.values():
        duration = wav_duration_seconds(os.path.join(recordings_dir, rel.lstrip("/")))
        if duration is not None:
            best = max(best or 0.0, duration)
    return best
