# tests/test_writer.py  — replace entire file
import pytest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "server"))

from writer import format_note


def test_format_note_returns_string():
    config = {"bvid": "BV123"}
    result = format_note("My Video", "transcript text", config, "cc_subtitle")
    assert isinstance(result, str)


def test_format_note_contains_frontmatter():
    config = {"bvid": "BV123"}
    result = format_note("My Video", "transcript text", config, "cc_subtitle")
    assert "title: My Video" in result
    assert "platform: bilibili" in result
    assert "transcript_method: cc_subtitle" in result
    assert "transcript text" in result


def test_format_note_includes_source_url():
    config = {"bvid": "BV1abc123XY"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "BV1abc123XY" in result
    assert "bilibili.com/video" in result


def test_format_note_starts_with_frontmatter_delimiter():
    config = {"bvid": "BV123"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert result.startswith("---")


def test_format_note_handles_missing_bvid():
    config = {}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert isinstance(result, str)
    assert "title: Title" in result
