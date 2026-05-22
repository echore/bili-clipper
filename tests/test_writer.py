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
    assert 'title: "My Video"' in result
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
    assert 'title: "Title"' in result


def test_format_note_contains_iframe():
    config = {"bvid": "BV123", "cid": "456", "aid": "789"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "<iframe" in result
    assert "player.bilibili.com" in result
    assert "BV123" in result


def test_format_note_includes_author():
    config = {"bvid": "BV123", "author": "某UP主"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert 'author: "某UP主"' in result


def test_format_note_with_desc_adds_intro_section():
    config = {"bvid": "BV123", "desc": "这是视频简介"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "## 简介" in result
    assert "这是视频简介" in result


def test_format_note_always_has_subtitle_header():
    config = {"bvid": "BV123", "desc": ""}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "## 字幕" in result


def test_format_note_without_desc_no_intro_section():
    config = {"bvid": "BV123", "desc": ""}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "## 简介" not in result


def test_format_note_desc_none_no_intro_section():
    config = {"bvid": "BV123"}
    result = format_note("Title", "text", config, "cc_subtitle")
    assert "## 简介" not in result
    assert "## 字幕" in result
