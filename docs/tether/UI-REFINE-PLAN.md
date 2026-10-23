# UI refinement plan · branch `ui/3d-polish`

A parallel work stream that adds 3D illustration assets and interaction polish to the app without
blocking the main build. It works in its own worktree (`~/hackathon/tether-ui`), commits only to
`ui/3d-polish`, and is merged into `main` only after Alex says so. Nothing here changes Snowflake
objects, API routes, data shapes or clinical logic.

## Ground rules for staying out of the way

- **Additive first.** New files go in `app/web/public/assets/3d/`, `app/web/src/components/art/` and
  `app/web/src/styles/motion.css`. Existing files get small, local edits only.
- **Screens in flight are not touched.** `app/patients/*`, `app/rules/*`, `components/patients/*` and
  `components/rules/*` are still being built on `main`. This branch ships components those screens can
  adopt with one import (`<Illustration name="…">`, `<PathwayIcon condition="…">`); it does not edit them.
- **Touched on this branch (expect small merges):** `components/EmptyState.tsx` (optional `art` prop,
  backwards compatible), `components/states.module.css`, `components/shell/TopBar.tsx` (brand mark),
  `components/shell/shell.module.css`, `components/queue/QueueView.tsx`, `components/queue/ApprovalCard.tsx`,
  `components/queue/UrgentBanner.tsx`, `components/queue/queue.module.css`, `app/globals.css` (import of
  `motion.css`).
- **Design system wins.** Marker yellow-green means AI only; alert red is for red flags only and stays
  an outline or chip, not a large fill; no Snowflake or Anthropic logos anywhere; synthetic data only.
- **Reduced motion.** Every animation has a `prefers-reduced-motion` fallback (a short cross-fade or none).

## Assets (generated with Codex image generation, reviewed before use)

One art direction for all of them: refined 3D, matte clay with frosted glass, soft studio light, on the
app's ink canvas (`#0A0D11`), lime `#CFEA55` used only for the AI-related glow, clinical teal-green
`#56CFA8` for care, no text, no logos, no people.

| File | Use |
|---|---|
| `hero-tether.webp` | Queue header and empty states: a glowing thread linking a home to a clinic |
| `empty-queue.webp` | Queue empty state: a neat stack of approved cards |
| `empty-patients.webp` | Patients empty state: a calm home with the thread |
| `pathway-copd.webp` | Pathway icon: lungs with a pulse oximeter |
| `pathway-bp.webp` | Pathway icon: blood-pressure cuff and gauge |
| `pathway-diabetes.webp` | Pathway icon: glucose meter and drop |
| `redflag.webp` | Red-flag icon: a soft alert beacon |
| `ai-plan.webp` | AI Plan line: a note card with one highlighted line |
| `checkin-call.webp` | AI check-in call: a handset with sound waves |
| `rules-layers.webp` | Rules tab: three stacked translucent cards (P0, P1, P2) |

Sizes: icons 256 px, illustrations 960 px wide, all `.webp` with a PNG fallback where needed, total
under 1.5 MB.

## Interaction and motion

| Where | Refinement |
|---|---|
| Page enter | Content fades and rises 8 px (`--dur-panel`, `--ease-conduct`), cards stagger by 30 ms |
| Approval card | Hover lifts the border to `--line-strong`; Approve collapses the card with a 240 ms height and fade, then the queue count ticks |
| Red-flag banner | A slow, low-contrast pulse on the beacon icon only (never the whole card); stops after acknowledge |
| Buttons | Press scale 0.98 (`--dur-press`), focus ring unchanged |
| Simulated clock | The date changes with a short vertical flip; the panel shows "Re-running rules" with the existing step loader |
| Hero art | A very slow parallax drift on pointer move (max 6 px), off for reduced motion and touch |
| Empty states | Illustration fades in after text, so text is never delayed |

## Verification before asking to merge

1. `npm run lint` and `npx tsc --noEmit` in `app/web` are clean.
2. `npm run build` passes.
3. The side E2E harness runs against the branch on port 3200 with no new failures.
4. Screenshots at 1440×900 of the queue, a patient and the empty states in both themes.
5. A merge check against the latest `main` (`git merge --no-commit --no-ff main` in the worktree,
   then abort) shows which files conflict, so the merge can be planned with the main session.

## Status

| Step | State |
|---|---|
| Plan committed and pushed | done |
| Assets generated and reviewed | in progress |
| Motion layer and art components | in progress |
| Wiring into queue and shell | pending |
| Verification | pending |
