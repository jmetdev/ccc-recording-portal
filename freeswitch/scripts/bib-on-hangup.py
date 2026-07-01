#!/usr/bin/env python3
"""On BIB hangup: mix near+far stereo WAV, then notify the recording portal."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refci", required=True)
    parser.add_argument("--uuid", required=True)
    parser.add_argument("--recordings-dir", default="/var/lib/freeswitch/recordings")
    args = parser.parse_args()

    base = args.recordings_dir
    near = f"{base}/bib_{args.refci}_near_{args.uuid}.wav"
    far = f"{base}/bib_{args.refci}_far_{args.uuid}.wav"
    stereo = f"{base}/bib_{args.refci}_stereo_{args.uuid}.wav"

    if os.path.isfile(near) and os.path.isfile(far):
        subprocess.run(
            [sys.executable, os.path.join(SCRIPT_DIR, "mix-bib-stereo.py"), "--near", near, "--far", far, "--out", stereo],
            check=False,
        )

    files = []
    for leg, path in [("near", near), ("far", far), ("stereo", stereo)]:
        if os.path.isfile(path):
            files.append(f"{leg}={path}")
    if not files:
        print("No recording files found", file=sys.stderr)
        sys.exit(0)

    subprocess.run(
        [
            sys.executable,
            os.path.join(SCRIPT_DIR, "notify-recording.py"),
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
