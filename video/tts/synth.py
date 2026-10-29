"""script.*.json dagi har sahna uchun lokal Kokoro-82M (ONNX) bilan ovoz yasaydi.
Ishlatish: tts/.venv/bin/python tts/synth.py <script.json> <outdir> [voice=af_heart] [speed=1.0]
Natija: <outdir>/<id>.wav (24 kHz mono) va <outdir>/audio.json {id: soniya}
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

script, outdir = Path(sys.argv[1]), Path(sys.argv[2])
voice = sys.argv[3] if len(sys.argv) > 3 else "af_heart"
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
outdir.mkdir(parents=True, exist_ok=True)
here = Path(__file__).parent
k = Kokoro(str(here / "models/kokoro-v1.0.onnx"), str(here / "models/voices-v1.0.bin"))

durations = {}
for sc in json.loads(script.read_text())["scenes"]:
    samples, sr = k.create(sc["say"], voice=voice, speed=speed, lang="en-us")
    # Boshidagi/oxiridagi jimlikni qisqartiramiz (aniq sinxron uchun), 80 ms nafas qoldiramiz
    a = np.abs(samples)
    idx = np.where(a > 0.004)[0]
    if len(idx):
        s0, s1 = max(0, idx[0] - int(0.08 * sr)), min(len(samples), idx[-1] + int(0.12 * sr))
        samples = samples[s0:s1]
    sf.write(outdir / f"{sc['id']}.wav", samples, sr)
    durations[sc["id"]] = round(len(samples) / sr, 3)
    print(f"{sc['id']:9s} {durations[sc['id']]:6.2f}s  {sc['say'][:70]}")
(outdir / "audio.json").write_text(json.dumps({"voice": voice, "speed": speed, "sampleRate": 24000, "durations": durations}, indent=2))
print("total narration:", round(sum(durations.values()), 1), "s")
