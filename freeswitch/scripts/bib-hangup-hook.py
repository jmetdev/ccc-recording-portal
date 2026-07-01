#!/usr/bin/env python3
"""Mix BIB legs (when both exist) and notify the recording portal on hangup."""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import time
import wave

RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/var/lib/freeswitch/recordings")
DEBUG_LOG = os.path.join(RECORDINGS_DIR, ".debug-d3dd31.log")


def _debug_log(message: str, data: dict | None = None, hypothesis_id: str = "H4") -> None:
    # #region agent log
    try:
        payload = {
            "sessionId": "d3dd31",
            "timestamp": int(time.time() * 1000),
            "location": "bib-hangup-hook.py",
            "message": message,
            "data": data or {},
            "hypothesisId": hypothesis_id,
            "runId": "post-fix",
        }
        with open(DEBUG_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except OSError:
        pass
    # #endregion


def find_latest(pattern: str) -> str | None:
    files = glob.glob(pattern)
    return max(files, key=os.path.getmtime) if files else None


def rel_path(path: str) -> str:
    name = os.path.basename(path)
    return name


def wav_duration(path: str) -> float | None:
    try:
        with wave.open(path, "rb") as wf:
            rate = wf.getframerate()
            if rate <= 0:
                return None
            return wf.getnframes() / float(rate)
    except (OSError, wave.Error):
        return None


def longest_duration(paths: list[str]) -> float | None:
    best: float | None = None
    for path in paths:
        if not path or not os.path.isfile(path):
            continue
        duration = wav_duration(path)
        if duration is not None:
            best = max(best or 0.0, duration)
    return best


def collect_file_pairs(refci: str, recordings_dir: str, base: str | None) -> list[str]:
    sbin = "/usr/local/sbin"
    if base:
        near = os.path.join(recordings_dir, f"{base}_near.wav")
        far = os.path.join(recordings_dir, f"{base}_far.wav")
        stereo = os.path.join(recordings_dir, f"{base}_stereo.wav")
        if os.path.isfile(near) and os.path.isfile(far):
            subprocess.run(
                [sys.executable, f"{sbin}/mix-bib-stereo.py", "--near", near, "--far", far, "--out", stereo],
                check=False,
            )
        file_pairs = []
        for leg in ("near", "far", "stereo"):
            rel = f"{base}_{leg}.wav"
            if os.path.isfile(os.path.join(recordings_dir, rel)):
                file_pairs.append(f"{leg}={rel}")
        return file_pairs

    subprocess.run([sys.executable, f"{sbin}/mix-bib-stereo.py", refci], check=False)
    file_pairs = []
    for leg, pattern in (
        ("near", f"cucm_{refci}_near_*.wav"),
        ("far", f"cucm_{refci}_far_*.wav"),
        ("stereo", f"cucm_{refci}_stereo_*.wav"),
    ):
        path = find_latest(os.path.join(recordings_dir, pattern))
        if path:
            file_pairs.append(f"{leg}={rel_path(path)}")
    return file_pairs


def notify_fail(refci: str, reason: str) -> None:
    subprocess.run(
        [sys.executable, "/usr/local/sbin/notify-recording.py", "fail", "--refci", refci, "--reason", reason],
        check=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refci", required=True)
    parser.add_argument("--base", help="Legacy basename without leg suffix")
    parser.add_argument("--recordings-dir", default=RECORDINGS_DIR)
    args = parser.parse_args()

    recordings_dir = args.recordings_dir
    file_pairs: list[str] = []
    for attempt in range(6):
        file_pairs = collect_file_pairs(args.refci, recordings_dir, args.base)
        if file_pairs:
            break
        _debug_log("hangup waiting for recordings", {"refci": args.refci, "attempt": attempt}, hypothesis_id="H4")
        time.sleep(1)

    if not file_pairs:
        reason = "no recordings found after hangup retries"
        print(f"bib-hangup-hook: {reason} for refci={args.refci}", file=sys.stderr)
        _debug_log("hangup failed - no recordings", {"refci": args.refci}, hypothesis_id="H4")
        notify_fail(args.refci, reason)
        return

    wav_paths = []
    for pair in file_pairs:
        _, _, rel = pair.partition("=")
        if rel:
            wav_paths.append(os.path.join(recordings_dir, rel))
    duration_s = longest_duration(wav_paths)

    complete_cmd = [
        sys.executable,
        "/usr/local/sbin/notify-recording.py",
        "complete",
        "--refci",
        args.refci,
        "--files",
        ",".join(file_pairs),
    ]
    if duration_s is not None:
        complete_cmd.extend(["--duration-s", f"{duration_s:.3f}"])

    _debug_log("hangup complete notify", {"refci": args.refci, "files": file_pairs}, hypothesis_id="H4")
    subprocess.run(complete_cmd, check=False)


if __name__ == "__main__":
    main()
