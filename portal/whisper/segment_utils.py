"""Pure helpers for turning Whisper output into transcript segment bubbles."""

from __future__ import annotations

WORD_GAP_SPLIT_S = 0.5


def _word_text(word) -> str:
    return (getattr(word, "word", None) or getattr(word, "text", None) or "").strip()


def _join_word_texts(chunk_words: list) -> str:
    texts = [_word_text(w) for w in chunk_words]
    texts = [t for t in texts if t]
    if not texts:
        return ""
    raw = [getattr(w, "word", None) or getattr(w, "text", None) or "" for w in chunk_words]
    if any(part.startswith(" ") for part in raw):
        return "".join(raw).strip()
    return " ".join(texts)


def segments_from_whisper_seg(seg, *, word_gap_s: float = WORD_GAP_SPLIT_S) -> list[dict]:
    """Emit one or more ``{start, end, text}`` dicts; split on listening pauses."""
    seg_text = (getattr(seg, "text", None) or "").strip()
    if not seg_text:
        return []

    words = getattr(seg, "words", None) or []
    timed = [
        w
        for w in words
        if getattr(w, "start", None) is not None
        and getattr(w, "end", None) is not None
        and _word_text(w)
    ]

    if not timed:
        start = float(seg.start)
        end = float(seg.end)
        if end < start:
            end = start
        return [{"start": start, "end": end, "text": seg_text}]

    pieces: list[dict] = []
    chunk_words: list = []
    chunk_start: float | None = None
    chunk_end: float | None = None
    prev_end: float | None = None

    def flush() -> None:
        nonlocal chunk_words, chunk_start, chunk_end
        if not chunk_words:
            return
        text = _join_word_texts(chunk_words)
        if not text:
            chunk_words = []
            chunk_start = chunk_end = None
            return
        start = chunk_start if chunk_start is not None else float(chunk_words[0].start)
        end = chunk_end if chunk_end is not None else float(chunk_words[-1].end)
        if end < start:
            end = start
        pieces.append({"start": start, "end": end, "text": text})
        chunk_words = []
        chunk_start = chunk_end = None

    for word in words:
        text = _word_text(word)
        if not text:
            continue
        w_start = getattr(word, "start", None)
        w_end = getattr(word, "end", None)
        if w_start is None or w_end is None:
            chunk_words.append(word)
            continue
        start_f = float(w_start)
        end_f = float(w_end)
        if prev_end is not None and start_f - prev_end >= word_gap_s:
            flush()
        chunk_words.append(word)
        if chunk_start is None:
            chunk_start = start_f
        chunk_end = end_f
        prev_end = end_f

    flush()

    if not pieces:
        start = float(timed[0].start)
        end = float(timed[-1].end)
        return [{"start": start, "end": end, "text": seg_text}]

    return pieces
