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


def _build_embed_iframe(bvid: str, cid: str, aid: str) -> str:
    return (
        f'<iframe src="https://player.bilibili.com/player.html'
        f'?bvid={bvid}&cid={cid}&aid={aid}&page=1&autoplay=0" '
        f'scrolling="no" border="0" frameborder="no" framespacing="0" '
        f'allowfullscreen="true" style="width:100%;aspect-ratio:16/9;"></iframe>'
    )


def format_note(title: str, transcript: str, config: dict, method: str) -> str:
    bvid = config.get("bvid") or ""
    aid = config.get("aid") or ""
    cid = config.get("cid") or ""
    author = config.get("author") or ""
    desc = config.get("desc") or ""
    source_url = f"https://www.bilibili.com/video/{bvid}" if bvid else ""
    safe_title = title.replace('"', '\\"')
    safe_author = author.replace('"', '\\"')
    body = _split_paragraphs(transcript)

    lines = [
        "---",
        f'title: "{safe_title}"',
        f"source: {source_url}",
        "platform: bilibili",
    ]
    if safe_author:
        lines.append(f'author: "{safe_author}"')
    lines += [
        f"date: {date.today().isoformat()}",
        "tags: [transcript, bilibili]",
        f"transcript_method: {method}",
        "---",
        "",
        _build_embed_iframe(bvid, cid, aid),
        "",
    ]

    if desc and desc.strip():
        lines += ["## 简介", "", desc.strip(), ""]

    lines += ["## 字幕", "", body]
    return "\n".join(lines)
