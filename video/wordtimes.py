"""Har sahna ovozi uchun so'zma-so'z vaqtlar (karaoke izohlar uchun): faster-whisper word_timestamps + ko'rinadigan matnga moslash.
Ishlatish: python3 video/wordtimes.py <script.json> <audio dir> [model=small]     (pip install faster-whisper numpy)
Natija: <audio dir>/words.json = { sceneId: [ {w: "Next.js,", s: 0.42, e: 0.81}, ... ] } (sekund, ovoz boshiga nisbatan).
Whisper tanigan so'zlar ko'rinadigan so'zlar bilan difflib orqali moslanadi; moslanmaganlari qo'shni so'zlar orasida tekis taqsimlanadi.
"""
import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

script, adir = Path(sys.argv[1]), Path(sys.argv[2])
model = WhisperModel(sys.argv[3] if len(sys.argv) > 3 else "small", device="cpu", compute_type="int8")

def display(text: str) -> str:
    return text.replace("Next J S", "Next.js").replace("A.I.", "AI")

def norm(w: str) -> str:
    w = w.lower().replace("x-ray", "xray").replace(".js", "js")
    return re.sub(r"[^a-z0-9]", "", w)

out = {}
for sc in json.loads(script.read_text())["scenes"]:
    wav = adir / f"{sc['id']}.wav"
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    dur = len(raw) / 4 / 16000
    segs, _ = model.transcribe(np.frombuffer(raw, dtype=np.float32), language="en", beam_size=5, word_timestamps=True)
    heard = [(norm(w.word), w.start, w.end) for s in segs for w in s.words if norm(w.word)]
    shown = display(sc.get("sub") or sc["say"]).split()
    sn = [norm(w) for w in shown]
    # "Next J S" -> "nextjs": birlashtirilgan ko'rinadigan so'zlar uchun eshitilgan qatorni ham birlashtiramiz
    hn = [h[0] for h in heard]
    sm = difflib.SequenceMatcher(a=sn, b=hn, autojunk=False)
    t_s: list = [None] * len(shown)
    t_e: list = [None] * len(shown)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            t_s[blk.a + k], t_e[blk.a + k] = heard[blk.b + k][1], heard[blk.b + k][2]
    # moslanmaganlarni qo'shni moslangan so'zlar orasida tekis taqsimlaymiz
    i = 0
    while i < len(shown):
        if t_s[i] is not None:
            i += 1
            continue
        j = i
        while j < len(shown) and t_s[j] is None:
            j += 1
        a = t_e[i - 1] if i > 0 else (heard[0][1] if heard else 0.0)
        b = t_s[j] if j < len(shown) else (heard[-1][2] if heard else dur)
        n = j - i
        for k in range(n):
            t_s[i + k] = a + (b - a) * k / n
            t_e[i + k] = a + (b - a) * (k + 1) / n
        i = j
    out[sc["id"]] = [{"w": shown[k], "s": round(float(t_s[k]), 3), "e": round(float(t_e[k]), 3)} for k in range(len(shown))]
    miss = sum(1 for x in sm.get_matching_blocks() for _ in range(x.size))
    print(f"{sc['id']:9s} {len(shown):3d} so'z, moslangan {miss:3d}  ({out[sc['id']][0]['s']:.2f}s … {out[sc['id']][-1]['e']:.2f}s / {dur:.2f}s)")
(adir / "words.json").write_text(json.dumps(out, indent=1))
