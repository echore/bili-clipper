import re
from datetime import date
from pathlib import Path


def sanitize_filename(title: str) -> str:
    sanitized = re.sub(r'[/\\:*?"<>|]', "", title)
    return sanitized[:100].strip()


def write_note(title: str, transcript: str, config: dict, method: str) -> str:
    vault_path = Path(config["vault_path"]).expanduser()
    folder = config.get("folder", "Raw")
    bvid = config.get("bvid", "")

    target_dir = vault_path / folder
    target_dir.mkdir(parents=True, exist_ok=True)

    filename = sanitize_filename(title) + ".md"
    target = target_dir / filename

    if target.exists():
        filename = f"{sanitize_filename(title)}-{date.today().isoformat()}.md"
        target = target_dir / filename

    source_url = f"https://www.bilibili.com/video/{bvid}" if bvid else ""

    content = f"""---
title: {title}
source: {source_url}
platform: bilibili
date: {date.today().isoformat()}
tags: [transcript, bilibili]
transcript_method: {method}
---

{transcript}
"""
    target.write_text(content, encoding="utf-8")
    return str(target.relative_to(vault_path))
