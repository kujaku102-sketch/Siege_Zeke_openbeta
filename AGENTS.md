# Public Simple Zeke workspace

- This is a standalone public development repository. The canonical source is `https://github.com/kujaku102-sketch/Siege_Zeke_openbeta` on `main`; develop from this checkout, not an old repository or parent workspace.
- The beta0.9.1 deployed revision is `76bbe3f892a41264`; beta0.9.2 is planned work, not an implemented release.

- This folder is a standalone staging product. Do not read or write parent workspaces during build, test, verification, or E2E.
- `src/data/cards.js` is the self-contained public card library. Do not replace it with canonical or source-generated card files.
- Do not add credentials, source spreadsheets, internal audits, Tusk files, logs, or deployment tokens.
- Keep internal documents, test evidence, original authoring files such as `.ai`/`.psd`, unapproved asset kits, and secrets outside this repository. Already-approved runtime PNG/SVG images stay included. Only the public rulebook and `docs/PUBLIC-DATA-BOUNDARY.md` belong under `docs/`.
- Do not commit optional `src/assets/fonts-local/` files. Preserve the bundled DotGothic16 OFL notice and the separate rights notices in `NOTICE.md`.
- The public card pool is staging-only and is not a production approval.
- Before runtime, AI, UI game-flow, or rule-related test changes, read `docs/rules/siege-zeke-rulebook-current.md` and `src/game/RULES.md`. These are intended rules, not proof of implementation parity.
- Evaluate victory using the state after each effect's full text, internal choices, and source cleanup (including sending an executed Sp to trash). The first qualifying completion boundary locks the result; both users qualifying at that boundary is a draw. Locking the result forbids new plays/declarations but does not end the game until both players' already-declared effects and their required choices finish. Later state changes cannot replace the locked result. Undeclared trigger candidates are not declared effects. Declaration may interrupt; do not infer interleaved effect resolution or retroactive effects from it. Do not infer rules from existing `winner` assignments.
- Keep build output in `dist/` and validate it with `pnpm verify:public` before any external deployment step.
