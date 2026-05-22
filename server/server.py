import json
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn

from transcriber import download_audio, transcribe
from writer import format_note

app = FastAPI(title="Bili Clipper Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class Config(BaseModel):
    folder: str = "Raw"
    output: str = "obsidian"
    model: str = "large-v3-turbo"
    bvid: Optional[str] = None
    aid: Optional[str] = None
    cid: Optional[str] = None
    author: Optional[str] = None
    desc: Optional[str] = None


class ClipRequest(BaseModel):
    bvid: str
    title: str
    transcript: Optional[str] = None  # if provided, skip transcription
    config: Config = Config()


@app.get("/health")
def health():
    from transcriber import _DEFAULT_MODEL
    return {"status": "ok", "model": _DEFAULT_MODEL}


@app.get("/vaults")
def list_vaults():
    """Return Obsidian vault names from Obsidian's own config file.
    Used by the extension popup for auto-detection — no manual vault path entry needed.
    """
    config_path = (
        Path.home() / "Library" / "Application Support" / "obsidian" / "obsidian.json"
    )
    if not config_path.exists():
        return {"vaults": []}
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
        vaults = [
            {"name": Path(v["path"]).name, "path": v["path"]}
            for v in data.get("vaults", {}).values()
            if "path" in v
        ]
        return {"vaults": vaults}
    except Exception:
        return {"vaults": []}


@app.post("/clip")
async def clip(req: ClipRequest):
    """Transcribe (if needed) and format a note.

    If transcript is provided (CC subtitle fast path): just format and return.
    If no transcript: download audio via yt-dlp and transcribe with mlx-whisper.

    Returns the formatted markdown note content — the extension writes it to Obsidian
    via clipboard + obsidian:// URI (no file I/O on the server side).
    """
    try:
        config = req.config.model_dump()
        config["bvid"] = req.bvid  # ensure bvid is in config for source URL

        if req.transcript:
            note = format_note(req.title, req.transcript, config, method="cc_subtitle")
        else:
            audio_path = await download_audio(req.bvid)
            transcript_text = await transcribe(audio_path, req.config.model)
            note = format_note(
                req.title,
                transcript_text,
                config,
                method=f"qwen3_asr_{req.config.model}",
            )
        return {"success": True, "note": note}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=27182, log_level="info")
