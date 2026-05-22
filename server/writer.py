import re
from datetime import date

_SENTENCE_END = re.compile(r'([。！？…]+["」』]?)')
_SENTENCES_PER_PARA = 4


def _split_paragraphs(text: str) -> str:
    """Group Chinese sentences into readable paragraphs.

    Splits on sentence-ending punctuation, then bundles every
    _SENTENCES_PER_PARA sentences into one paragraph separated by blank lines.
    Falls back to the original text if no punctuation is found.
    """
    # Normalise: collapse whitespace/newlines into a single space
    text = re.sub(r'\s+', ' ', text).strip()

    # Split into sentences while keeping the delimiter
    parts = _SENTENCE_END.split(text)
    # parts alternates: [text, delim, text, delim, ...]
    sentences: list[str] = []
    for i in range(0, len(parts) - 1, 2):
        sentence = (parts[i] + parts[i + 1]).strip()
        if sentence:
            sentences.append(sentence)
    # Trailing fragment without punctuation
    if len(parts) % 2 == 1 and parts[-1].strip():
        sentences.append(parts[-1].strip())

    if not sentences:
        return text  # no punctuation found — return as-is

    paragraphs = []
    for i in range(0, len(sentences), _SENTENCES_PER_PARA):
        paragraphs.append(''.join(sentences[i:i + _SENTENCES_PER_PARA]))

    return '\n\n'.join(paragraphs)


def format_note(title: str, transcript: str, config: dict, method: str) -> str:
    bvid = config.get("bvid", "")
    source_url = f"https://www.bilibili.com/video/{bvid}" if bvid else ""
    safe_title = title.replace('"', '\\"')
    body = _split_paragraphs(transcript)

    return f"""---
title: "{safe_title}"
source: {source_url}
platform: bilibili
date: {date.today().isoformat()}
tags: [transcript, bilibili]
transcript_method: {method}
---

{body}
"""
