#!/usr/bin/env python3
"""Run mix-bib-stereo then notify portal on BIB hangup."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refci", required=True)
    parser.add_argument("--base", required=True, help="Recording basename without leg suffix")
    parser.add_argument("--recordings-dir", default=os.environ.get("RECORDINGS_DIR", "/var/lib/freeswitch/recordings"))
    args = parser.parse_args()

    sbin = "/usr/local/sbin"
    near = os.path.join(args.recordings_dir, f"{args.base}_near.wav")
    far = os.path.join(args.recordings_dir, f"{args.base}_far.wav")
    stereo = os.path.join(args.recordings_dir, f"{args.base}_stereo.wav")

    if os.path.isfile(near) and os.path.isfile(far):
        subprocess.run(
            [sys.executable, f"{sbin}/mix-bib-stereo.py", "--near", near, "--far", far, "--out", stereo],
            check=False,
        )

    files = []
    for leg in ("near", "far", "stereo"):
        rel = f"{args.base}_{leg}.wav"
        if os.path.isfile(os.path.join(args.recordings_dir, rel)):
            files.append(f"{leg}={rel}")

    if not files:
        return

    subprocess.run(
        [
            sys.executable,
            f"{sbin}/notify-recording.py",
            "complete",
            "--refci",
            args.refci,
            "--files",
            ",".join(files),
        ],
        check=False,
    )


if __name__ == "__main__":
    main()
