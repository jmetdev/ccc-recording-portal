#!/usr/bin/env python3
"""Mix CUCM BIB near/far mono WAV legs into a stereo WAV (L=near, R=far)."""

from __future__ import annotations

import argparse
import os
import struct
import sys
import wave


def read_wav(path: str) -> tuple[bytes, int, int, int]:
    with wave.open(path, "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
    if channels > 1:
        # downmix to mono by taking left channel samples
        if sample_width != 2:
            raise ValueError(f"Unsupported sample width: {sample_width}")
        samples = struct.unpack(f"<{len(frames)//2}h", frames)
        mono = samples[::channels]
        frames = struct.pack(f"<{len(mono)}h", *mono)
        channels = 1
    return frames, rate, sample_width, channels


def pad_to_length(data: bytes, sample_width: int, target_samples: int) -> bytes:
    current = len(data) // sample_width
    if current >= target_samples:
        return data[: target_samples * sample_width]
    pad = b"\x00" * ((target_samples - current) * sample_width)
    return data + pad


def mix_stereo(near_path: str, far_path: str, out_path: str) -> None:
    near_frames, rate, sw, _ = read_wav(near_path)
    far_frames, rate2, sw2, _ = read_wav(far_path)
    if rate != rate2 or sw != sw2:
        raise ValueError("Near/far WAV format mismatch")
    near_samples = len(near_frames) // sw
    far_samples = len(far_frames) // sw
    total = max(near_samples, far_samples)
    near_frames = pad_to_length(near_frames, sw, total)
    far_frames = pad_to_length(far_frames, sw, total)

    if sw != 2:
        raise ValueError("Only 16-bit PCM supported")

    near = struct.unpack(f"<{total}h", near_frames)
    far = struct.unpack(f"<{total}h", far_frames)
    stereo = []
    for n, f in zip(near, far):
        stereo.extend([n, f])
    out_data = struct.pack(f"<{len(stereo)}h", *stereo)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(sw)
        wf.setframerate(rate)
        wf.writeframes(out_data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--near", required=True)
    parser.add_argument("--far", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    try:
        mix_stereo(args.near, args.far, args.out)
    except Exception as exc:
        print(f"mix-bib-stereo error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
