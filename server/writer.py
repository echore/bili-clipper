# server/writer.py  — replace entire file
from datetime import date


def format_note(title: str, transcript: str, config: dict, method: str) -> str:
    """Format transcript as a markdown note with YAML frontmatter.

    Returns the complete note content as a string.
    Does NOT write to disk — the caller (extension or test) handles delivery.
    """
    bvid = config.get("bvid", "")
    source_url = f"https://www.bilibili.com/video/{bvid}" if bvid else ""

    return f"""---
title: {title}
source: {source_url}
platform: bilibili
date: {date.today().isoformat()}
tags: [transcript, bilibili]
transcript_method: {method}
---

{transcript}
"""
