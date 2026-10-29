"""Kokoro-82M (ONNX, lokal, Apache-2.0) bilan matnni ovozga aylantiradi.
Ishlatish: .venv/bin/python say.py <voice> <speed> <out.wav> <text...>
"""
import sys
import soundfile as sf
from kokoro_onnx import Kokoro

voice, speed, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
text = " ".join(sys.argv[4:])
k = Kokoro("models/kokoro-v1.0.onnx", "models/voices-v1.0.bin")
samples, sr = k.create(text, voice=voice, speed=speed, lang="en-us")
sf.write(out, samples, sr)
print(f"{out}: {len(samples)/sr:.2f}s @ {sr} Hz")
