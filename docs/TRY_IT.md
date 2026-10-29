# Trying X-Ray (10 minutes)

🇺🇿 O'zbekcha: [docs/uz/TRY_IT.md](uz/TRY_IT.md)

X-Ray is a local tool that, starting from a Git diff, answers "what may this change affect?" **with evidence** (TypeScript/React/Next.js).

## Privacy (read this first)
- Analysis runs **only on your machine**. Your code is not sent anywhere.
- **Nothing is written** to your repo (the index lives in `~/.cache/xray`), and scripts/configs in the repo are **not executed**.
- AI is **off** by default. If you don't enable it, there is no network access at all.

## Install
Requires: Node.js 26 (tested on Node v26.11), [pnpm](https://pnpm.io), git. Tested on Linux only.

```bash
git clone https://github.com/lynxstac/xray.git xray && cd xray
pnpm install
pnpm demo        # built-in example: change → report (about 5 seconds)
```
`pnpm demo` should show in the report that the signature of `formatDate` changed and which components are affected. If it doesn't, stop here and report it.

## On your own project
```bash
pnpm xray index  /path/to/project             # index (should take no more than 1–2 minutes)
pnpm xray impact /path/to/project             # current (uncommitted) changes
pnpm xray impact /path/to/project --base main --head HEAD   # branch/PR
pnpm serve                                    # web UI — open the URL printed in the terminal
```
In the web UI: "Repository" → enter the path → "Change Impact" → "Analyze".

## 3 things to try
1. **Latest PR/commit:** get a report with `--base <previous> --head <this>`. Is the "Direct" list really tied to this change?
2. **Change a signature:** add a parameter to some function (without committing) and run `pnpm xray impact`. Did all the callers show up?
3. **If it's Next.js:** change `layout.tsx` or a middleware — is the "Routes" tab correct?

Click any result to see its **evidence path** (which line, which chain). `verified` — the relationship is statically proven; `possible` — approximate. The report never says "this will break".

## What it may not know (a heads-up)
Dynamic `import(x)`, framework "magic" (Server Actions, redirect/rewrite), and string-based linking — these are shown openly in the **"Unresolved"** tab, not hidden. Full list: `docs/KNOWN_LIMITS.md`.

## Your feedback
Answer the 6 questions in `docs/FEEDBACK_TEMPLATE.md` (5 minutes). The most important one is the first.
