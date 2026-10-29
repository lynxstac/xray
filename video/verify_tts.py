"""Sintez qilingan ovozni lokal Whisper bilan matnga qaytaradi va ssenariy bilan solishtiradi (WER).
Ishlatish: <lynx venv python> video/verify_tts.py <script.json> <audio dir> [model=small]
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

from faster_whisper import WhisperModel

script, adir = Path(sys.argv[1]), Path(sys.argv[2])
model = WhisperModel(sys.argv[3] if len(sys.argv) > 3 else "small", device="cpu", compute_type="int8")

def norm(s: str) -> list[str]:
    s = s.lower().replace("x-ray", "xray").replace("next j s", "nextjs").replace("next.js", "nextjs").replace("a.i.", "ai").replace("a i ", "ai ").replace("local-first", "local first")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return s.split()

def wer(ref: list[str], hyp: list[str]) -> float:
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
            prev, d[j] = d[j], cur
    return d[len(hyp)] / max(1, len(ref))

tot_err = tot_words = 0.0
for sc in json.loads(script.read_text())["scenes"]:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(adir / f"{sc['id']}.wav"), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    segs, _ = model.transcribe(np.frombuffer(raw, dtype=np.float32), language="en", beam_size=5)
    hyp = " ".join(s.text for s in segs).strip()
    ref, h = norm(sc["say"]), norm(hyp)
    w = wer(ref, h)
    tot_err += w * len(ref); tot_words += len(ref)
    flag = "" if w <= 0.12 else "  <-- CHECK"
    print(f"{sc['id']:9s} WER {w*100:5.1f}%{flag}\n   said: {hyp}")
print(f"\nOVERALL WER {tot_err/tot_words*100:.1f}% over {int(tot_words)} words")
