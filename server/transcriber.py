import asyncio
import tempfile
from pathlib import Path
from faster_whisper import WhisperModel

# launchd doesn't inherit the user's PATH, so resolve tools by absolute path
_YTDLP = Path(__file__).parent / ".venv" / "bin" / "yt-dlp"

# ffmpeg is a system tool (Homebrew); search common locations as a fallback
# even when PATH is set correctly in the plist
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

_model_cache: dict[str, WhisperModel] = {}
_model_lock = asyncio.Lock()


def get_model(model_name: str = "large-v3-turbo") -> WhisperModel:
    if model_name not in _model_cache:
        _model_cache[model_name] = WhisperModel(
            model_name, device="auto", compute_type="auto"
        )
    return _model_cache[model_name]


def _transcribe_sync(audio_path: Path, model_name: str) -> str:
    model = get_model(model_name)
    segments, _info = model.transcribe(
        str(audio_path),
        language="zh",
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    return "".join(s.text for s in segments)


async def transcribe(audio_path: Path, model_name: str = "large-v3-turbo") -> str:
    return await asyncio.to_thread(_transcribe_sync, audio_path, model_name)


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
