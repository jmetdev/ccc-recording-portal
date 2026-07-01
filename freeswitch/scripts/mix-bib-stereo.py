#!/usr/bin/env python3
"""Merge CUCM BIB near/far mono legs into stereo WAV (L=near, R=far)."""

from __future__ import annotations

import argparse
import fcntl
import glob
import os
import struct
import sys
import wave

RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/var/lib/freeswitch/recordings")
FS_UID = int(os.environ.get("FS_UID", "499"))
FS_GID = int(os.environ.get("FS_GID", "499"))


def find_latest(pattern: str) -> str | None:
    files = glob.glob(pattern)
    return max(files, key=os.path.getmtime) if files else None


def read_mono(path: str) -> tuple[int, bytes]:
    with wave.open(path, "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise ValueError(f"expected mono 16-bit PCM: {path}")
        return wf.getframerate(), wf.readframes(wf.getnframes())


def write_stereo(out_path: str, rate: int, near: bytes, far: bytes) -> None:
    sample_bytes = 2
    n_samples = len(near) // sample_bytes
    f_samples = len(far) // sample_bytes
    max_samples = max(n_samples, f_samples)
    pad = b"\x00\x00"
    near = near + pad * (max_samples - n_samples)
    far = far + pad * (max_samples - f_samples)

    stereo = bytearray(max_samples * 4)
    for i in range(max_samples):
        off = i * sample_bytes
        stereo[i * 4 : i * 4 + 2] = near[off : off + 2]
        stereo[i * 4 + 2 : i * 4 + 4] = far[off : off + 2]

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(stereo)


def chown_fs(path: str) -> None:
    try:
        os.chown(path, FS_UID, FS_GID)
    except OSError:
        pass


def mix_by_refci(refci: str) -> int:
    if not refci or refci in ("none", "unknown"):
        return 0

    lock_path = os.path.join(RECORDINGS_DIR, f".mix_{refci}.lock")
    os.makedirs(RECORDINGS_DIR, exist_ok=True)

    with open(lock_path, "w", encoding="utf-8") as lockf:
        try:
            fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0

        near = find_latest(os.path.join(RECORDINGS_DIR, f"cucm_{refci}_near_*.wav"))
        far = find_latest(os.path.join(RECORDINGS_DIR, f"cucm_{refci}_far_*.wav"))
        if not near or not far:
            return 0

        idx = os.path.basename(near).find("_near_")
        if idx < 0:
            return 1
        suffix = os.path.basename(near)[idx + len("_near_") :]
        out = os.path.join(RECORDINGS_DIR, f"cucm_{refci}_stereo_{suffix}")
        if os.path.exists(out):
            chown_fs(out)
            return 0

        rate_n, near_pcm = read_mono(near)
        rate_f, far_pcm = read_mono(far)
        if rate_n != rate_f:
            print(f"sample rate mismatch: {near} vs {far}", file=sys.stderr)
            return 1

        write_stereo(out, rate_n, near_pcm, far_pcm)
        chown_fs(out)
        chown_fs(near)
        chown_fs(far)
    return 0


def mix_explicit(near_path: str, far_path: str, out_path: str) -> None:
    rate_n, near_pcm = read_mono(near_path)
    rate_f, far_pcm = read_mono(far_path)
    if rate_n != rate_f:
        raise ValueError(f"sample rate mismatch: {near_path} vs {far_path}")
    write_stereo(out_path, rate_n, near_pcm, far_pcm)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("refci", nargs="?", help="Mix latest near/far legs for this refci")
    parser.add_argument("--near")
    parser.add_argument("--far")
    parser.add_argument("--out")
    args = parser.parse_args()

    if args.near and args.far and args.out:
        try:
            mix_explicit(args.near, args.far, args.out)
        except Exception as exc:
            print(f"mix-bib-stereo error: {exc}", file=sys.stderr)
            return 1
        return 0

    if args.refci:
        return mix_by_refci(args.refci.strip())

    parser.error("provide refci or --near/--far/--out")


if __name__ == "__main__":
    sys.exit(main())
