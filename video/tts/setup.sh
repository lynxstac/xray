#!/usr/bin/env bash
# Lokal ingliz TTS (Kokoro-82M, ONNX, Apache-2.0): venv + model fayllari. Disk: ~500 MB. Bir marta ishga tushiriladi.
set -euo pipefail
cd "$(dirname "$0")"
uv venv --python 3.12 .venv -q
uv pip install -q --python .venv/bin/python kokoro-onnx soundfile numpy
mkdir -p models
BASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -f models/kokoro-v1.0.onnx ] || curl -fL --retry 3 -o models/kokoro-v1.0.onnx "$BASE/kokoro-v1.0.onnx"
[ -f models/voices-v1.0.bin ] || curl -fL --retry 3 -o models/voices-v1.0.bin "$BASE/voices-v1.0.bin"
echo "tayyor: video/tts/.venv + models/"
