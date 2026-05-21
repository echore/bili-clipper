import pytest
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "server"))

from writer import sanitize_filename, write_note


def test_sanitize_removes_illegal_chars():
    result = sanitize_filename('video: "hello/world"')
    assert "/" not in result
    assert ":" not in result
    assert '"' not in result
    assert "hello" in result


def test_sanitize_truncates_long_titles():
    result = sanitize_filename("a" * 200)
    assert len(result) <= 100


def test_write_note_creates_file():
    with tempfile.TemporaryDirectory() as tmp:
        config = {"vault_path": tmp, "folder": "Raw", "bvid": "BV1234567890"}
        path = write_note("Test Title", "Hello transcript", config, method="cc_subtitle")
        assert (Path(tmp) / path).exists()


def test_write_note_frontmatter():
    with tempfile.TemporaryDirectory() as tmp:
        config = {"vault_path": tmp, "folder": "Raw", "bvid": "BV123"}
        path = write_note("My Video", "transcript text", config, method="cc_subtitle")
        content = (Path(tmp) / path).read_text()
        assert "title: My Video" in content
        assert "platform: bilibili" in content
        assert "transcript_method: cc_subtitle" in content
        assert "transcript text" in content
        assert "BV123" in content


def test_write_note_handles_duplicate_filename():
    with tempfile.TemporaryDirectory() as tmp:
        config = {"vault_path": tmp, "folder": "Raw", "bvid": "BV123"}
        path1 = write_note("Same Title", "first", config, method="cc_subtitle")
        path2 = write_note("Same Title", "second", config, method="cc_subtitle")
        assert path1 != path2
        assert (Path(tmp) / path1).exists()
        assert (Path(tmp) / path2).exists()


def test_write_note_creates_folder_if_missing():
    with tempfile.TemporaryDirectory() as tmp:
        config = {"vault_path": tmp, "folder": "Clips/Bilibili", "bvid": "BV123"}
        path = write_note("Video", "text", config, method="cc_subtitle")
        assert (Path(tmp) / path).exists()
