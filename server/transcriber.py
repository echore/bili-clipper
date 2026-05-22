import asyncio
import sys
import tempfile
from pathlib import Path
from mlx_qwen3_asr import transcribe as qwen_transcribe

# Derive yt-dlp from the running Python's venv bin dir — works regardless
# of where server.py lives (repo vs install dir).
_YTDLP = Path(sys.executable).parent / "yt-dlp"

_DEFAULT_MODEL = "Qwen/Qwen3-ASR-1.7B"

# Map user-facing short names to Qwen3-ASR HuggingFace model IDs.
# Extension sends short names; server resolves to backend-specific paths.
_MODEL_ALIASES: dict[str, str] = {
    "large-v3-turbo": "Qwen/Qwen3-ASR-1.7B",
    "large-v3":       "Qwen/Qwen3-ASR-1.7B",
    "medium":         "Qwen/Qwen3-ASR-1.7B",
    "small":          "Qwen/Qwen3-ASR-0.6B",
    "base":           "Qwen/Qwen3-ASR-0.6B",
    "1.7b":           "Qwen/Qwen3-ASR-1.7B",
    "0.6b":           "Qwen/Qwen3-ASR-0.6B",
}


def _resolve_model(name: str) -> str:
    return _MODEL_ALIASES.get(name, name)


def _find_ffmpeg() -> Path | None:
    for candidate in [
        Path("/opt/homebrew/bin/ffmpeg"),  # Apple Silicon Homebrew
        Path("/usr/local/bin/ffmpeg"),      # Intel Homebrew / manual install
        Path("/usr/bin/ffmpeg"),
    ]:
        if candidate.exists():
            return candidate
    return None


_FFMPEG = _find_ffmpeg()


def _transcribe_sync(audio_path: Path, model_name: str) -> str:
    result = qwen_transcribe(str(audio_path), model=model_name, language="Chinese")
    return result.text


async def transcribe(audio_path: Path, model_name: str = _DEFAULT_MODEL) -> str:
    return await asyncio.to_thread(_transcribe_sync, audio_path, _resolve_model(model_name))


async def download_audio(bvid: str) -> Path:
    tmp_dir = Path(tempfile.mkdtemp(prefix="bili-clipper-"))
    output_template = str(tmp_dir / "audio.%(ext)s")

    cmd = [
        str(_YTDLP),
        "-x",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--no-playlist",
        "--extractor-args", "bilibili:player_client=app",
        "-o", output_template,
        f"https://www.bilibili.com/video/{bvid}",
    ]
    if _FFMPEG:
        cmd += ["--ffmpeg-location", str(_FFMPEG.parent)]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {stderr.decode()}")

    wav_files = list(tmp_dir.glob("*.wav"))
    if not wav_files:
        audio_files = [f for f in tmp_dir.iterdir() if f.is_file()]
        if not audio_files:
            raise RuntimeError("No audio file downloaded")
        return audio_files[0]

    return wav_files[0]
