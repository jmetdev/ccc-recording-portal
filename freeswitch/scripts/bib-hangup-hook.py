#!/usr/bin/env python3
"""Mix BIB legs (when both exist) and notify the recording portal on hangup."""

from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys


RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/var/lib/freeswitch/recordings")


def find_latest(pattern: str) -> str | None:
    files = glob.glob(pattern)
    return max(files, key=os.path.getmtime) if files else None


def rel_path(path: str) -> str:
    name = os.path.basename(path)
    return name


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refci", required=True)
    parser.add_argument("--base", help="Legacy basename without leg suffix")
    parser.add_argument("--recordings-dir", default=RECORDINGS_DIR)
    args = parser.parse_args()

    sbin = "/usr/local/sbin"
    recordings_dir = args.recordings_dir

    if args.base:
        near = os.path.join(recordings_dir, f"{args.base}_near.wav")
        far = os.path.join(recordings_dir, f"{args.base}_far.wav")
        stereo = os.path.join(recordings_dir, f"{args.base}_stereo.wav")
        if os.path.isfile(near) and os.path.isfile(far):
            subprocess.run(
                [sys.executable, f"{sbin}/mix-bib-stereo.py", "--near", near, "--far", far, "--out", stereo],
                check=False,
            )
        file_pairs = []
        for leg in ("near", "far", "stereo"):
            rel = f"{args.base}_{leg}.wav"
            if os.path.isfile(os.path.join(recordings_dir, rel)):
                file_pairs.append(f"{leg}={rel}")
    else:
        subprocess.run([sys.executable, f"{sbin}/mix-bib-stereo.py", args.refci], check=False)
        file_pairs = []
        for leg, pattern in (
            ("near", f"cucm_{args.refci}_near_*.wav"),
            ("far", f"cucm_{args.refci}_far_*.wav"),
            ("stereo", f"cucm_{args.refci}_stereo_*.wav"),
        ):
            path = find_latest(os.path.join(recordings_dir, pattern))
            if path:
                file_pairs.append(f"{leg}={rel_path(path)}")

    if not file_pairs:
        print(f"bib-hangup-hook: no recordings found for refci={args.refci}", file=sys.stderr)
        return

    subprocess.run(
        [
            sys.executable,
            f"{sbin}/notify-recording.py",
            "complete",
            "--refci",
            args.refci,
            "--files",
            ",".join(file_pairs),
        ],
        check=False,
    )


if __name__ == "__main__":
    main()
