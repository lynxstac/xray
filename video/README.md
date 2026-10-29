# Demo video pipeline (YouTube 16:9 + Reels/Shorts 9:16)

Everything is **local** and reproducible: English voice-over (Kokoro-82M), real-browser screen recording at 2× scale, music, loudness normalisation, subtitles.

```
script.en.json ─► tts/synth.py ─► work/audio/*.wav (+ audio.json durations)
                                        │      wordtimes.py ─► work/audio/words.json (per-word timings)
                      record.ts ◄───────┤   every scene is paced to its narration length
                         │  Chrome (DSF 2) → CDP screencast → ffmpeg (30 fps, wall-clock exact)
                         ▼
                 work/master.mp4 (2560×1440) + timeline.json
                         │
                      render.ts ──► out/xray-youtube-1080p.mp4        (16:9, 1920×1080)
                                    out/xray-reel-1080x1920.mp4       (9:16, < 60 s: Reels + YouTube Shorts)
                                    *_alt-music.mp4, .srt/.vtt, thumbnail, cover, description texts
```

## Run it

```bash
pnpm video:setup                 # once: Kokoro venv + model (~500 MB)
pip install faster-whisper numpy # for word timings + verification
pnpm build:web                   # the UI must be built
pnpm video:audio                 # script → narration
pnpm video:words                 # narration → per-word timings (karaoke captions)
node video/record.ts <repo> <base-sha> <head-sha> --script video/script.en.json --audio video/work/audio --out video/work
pnpm video:render                # everything → video/out/
```

The demo in the repo uses the open-source `shadcn-ui/taxonomy` app (MIT), range `428b1260~1..428b1260`.
Script, on-screen captions and Reels crop regions live in `script.en.json`. Voice is `af_heart` (American, female) at speed 1.0; pass another voice to `synth.py` (`bm_george`, `am_michael`, …).

## Reels details

- 1080×1920, per-scene crop of the master with a slow zoom and alternating pan, rounded screen frame, Instagram safe zones respected (top ≈ 250 px, bottom ≈ 420 px).
- **Karaoke captions**: large, burned-in, the current word highlighted (timings from `wordtimes.py`), readable with sound off.
- A purpose-built vertical end card (nothing cropped).

## Automatic quality checks

- Voice ↔ text: `verify_tts.py` (local Whisper) — measures intelligibility, not naturalness.
- Loudness: two-pass `loudnorm` → **−14 LUFS**, true peak ≤ −1.4 dBFS. Music sits ~16 dB under the voice at a **constant level** (no ducking/pumping).
- Colour: BT.709, limited range, `yuv420p`.
- 30 fps, H.264 High, `+faststart`; AAC 48 kHz (YouTube 256k, Reels 192k).

## Outputs

| File | Format | For |
|---|---|---|
| `xray-youtube-1080p.mp4` | 1920×1080, ~87 s | YouTube (subtitles `.srt`/`.vtt`, chapters in `youtube-description.txt`, thumbnail 1280×720) |
| `xray-reel-1080x1920.mp4` | 1080×1920, ~49 s | Instagram Reels / YouTube Shorts / TikTok |
| `*_alt-music.mp4` | same, different track | alternative |
| `xray-reel-cover-1080x1920.png` | cover | Reels cover |

## Licences and caveats

- **Voice:** Kokoro-82M (Apache-2.0), synthesised locally.
- **Music:** Mixkit tracks ("Close Up" by Michael Ramir C., "Pop Track 03" by Lily J). Read https://mixkit.co/license/ before publishing; music is **not** part of this repository.
- Voice quality was checked with Whisper and measurements only — judge naturalness and pacing by ear before posting.
