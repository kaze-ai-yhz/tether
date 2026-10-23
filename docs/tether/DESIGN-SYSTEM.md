# Design system

A calm, clinical, evidence-first interface. Dark theme by default for the stage (it projects
well); a light theme for reading and printing shares every token path. Implement tokens as CSS
custom properties in `app/web/src/styles/tokens.css` and mirror them in `tokens.ts`. Components use
`react-aria-components` for behavior and accessibility.

## 1. Character

- **Calm.** Monochrome chrome; color is reserved for status and for AI provenance. If everything
  is highlighted, nothing is.
- **Evidence first.** Every automated line can show its rule, version, signer and inputs.
- **Two kinds of marks.** Human decisions are drawn in full-contrast Ink (the strongest mark on the
  page). Machine work is drawn in the Marker accent and always labeled.
- **Honest about simulation.** Simulated data and placeholder clinical values are visibly different
  (line style, tag, inline token), never just a footnote.

## 2. Color

### 2.1 Neutrals

| Token | Role | Light | Dark |
|---|---|---|---|
| `surface.canvas` | Page background | `#F5F6F7` | `#0A0D11` |
| `surface.default` | Panels, cards, table body | `#FFFFFF` | `#11151B` |
| `surface.raised` | Popovers, menus, dialogs, drawers | `#FFFFFF` + shadow | `#171C23` |
| `surface.sunken` | Wells, table headers, code/JSON blocks | `#ECEEF1` | `#07090C` |
| `surface.hover` | Row and control hover | `#ECEEF1` | `#1D232B` |
| `line.hairline` | Dividers, table rules (never the only boundary) | `#D5D9DF` | `#252B34` |
| `line.strong` | Section rules | `#B9C0C9` | `#363A41` |
| `line.boundary` | Inputs, control edges, chart axes (≥3:1) | `#7F8895` | `#6A7482` |
| `text.default` (Ink) | Text, human marks, primary button fill, focus ring | `#10141A` | `#E7EAEE` |
| `text.on-ink` | Text on Ink fills | `#F5F6F7` | `#0A0D11` |
| `text.muted` | Secondary text, captions, meta | `#535C68` | `#98A1AC` |
| `text.disabled` | Disabled text (not for information) | `#9AA2AD` | `#4A525E` |

### 2.2 AI provenance: Marker
Used only for things a model produced: "Drafted by Claude" chip, extracted-field highlights, the
AI Plan P2 highlights, the Ask drawer's step indicator. **Never** a button color, never a status,
under ~5% of the pixels on a screen.

| Token | Light | Dark |
|---|---|---|
| `marker.text` | `#4D6000` | `#CFEA55` |
| `marker.mark` | `#7A9A00` | `#CFEA55` |
| `marker.wash` | `#EEF6CF` | `#1E2510` |

### 2.3 Clinical status
Each status = foreground (text/icon) on a soft background with a border. All foreground/background
pairs below are ≥ 4.5:1 (measured).

| Status token | Used for | Light fg / bg / border | Dark fg / bg / border |
|---|---|---|---|
| `status.ok` | Complete, at goal, approved | `#1C7445` / `#E7F3EC` / `#8FC4A6` | `#56CFA8` / `#0E2620` / `#2A6B58` |
| `status.info` | Pending, Ongoing follow-up, Action taken | `#1762B6` / `#E8F0FA` / `#9DBDE6` | `#7FA9EE` / `#0F1A2B` / `#2C4A78` |
| `status.caution` | Awaiting approval, **Pending clinician confirmation**, PLACEHOLDER tokens | `#8F3E00` / `#FBF0E6` / `#E6A782` | `#F0B45A` / `#2A1F0E` / `#7A5524` |
| `status.alert` | Needs clinician (standard) | `#B0213A` / `#FBEAED` / `#E29AA8` | `#FF6B8B` / `#2B1219` / `#7D2E42` |
| `status.alert-strong` | Red flag urgent alert (filled chip, banner) | text `#FFFFFF` on `#B0213A` | text `#0A0D11` on `#FF6B8B` |
| `status.neutral` | Scheduled, Visited · no AI Plan | `text.muted` on `surface.sunken` | same |

Rules:
- Status is always a **word + icon + color**. Icons differ in shape (circle-check, pulse, eye,
  triangle, clock) so the meaning survives grayscale and color-vision deficiency.
- Only urgent escalations use a filled alert fill. One filled alert element per screen (the banner
  or the chip, not both in the same row).
- Caution is deliberately the same family as placeholders: unsigned content should look unfinished.

### 2.4 Data series
Wearable charts: heart rate line in `series.1`, threshold as a dashed `status.alert` line, baseline
as a dotted `text.muted` line.

| Token | Light | Dark |
|---|---|---|
| `series.1` | `#1762B6` | `#5A8EE4` |
| `series.2` | `#902559` | `#D75F94` |
| `series.3` | `#BF75D0` | `#884BAF` |

Wait / overdue ramp (for "overdue by" heat in tables), low → high:
Light `#E6A782 #DA8956 #CA6D2B #B15300 #8F3E00`; Dark `#7A4627 #9C562C #C86D34 #E9884D #FDAB7C`.

### 2.5 Line styles carry provenance
| Style | Meaning |
|---|---|
| Solid | Recorded fact (patient reply, clinician action, reading received) |
| Dashed 4/3 | Proposed or scheduled (upcoming todo, threshold, suggested case) |
| Dash-dot | **Simulated** (simulated wearable data, simulated outreach delivery) |
| Dotted | Not connected / no consent |

## 3. Typography

| Role | Font | Size / line | Weight |
|---|---|---|---|
| Display (README, empty hero) | Newsreader | 56 / 60 | 400 |
| H1 page title | Newsreader | 32 / 38 | 400 |
| H2 section | Inter | 22 / 28 | 600 |
| H3 card title | Inter | 16 / 22 | 600 |
| Body | Inter | 14 / 20 | 400 |
| Meta, captions, chips | Inter | 12 / 16 | 500 |
| Readout (KPI numbers) | Inter, tabular numerals | 28 / 32 | 600; unit at 60% size |
| Mono (rule ids, JSON, SQL, ids) | JetBrains Mono | 13 / 18 | 400 |

- Tabular numerals (`font-variant-numeric: tabular-nums`) for every number column and time.
- Patient-facing quotes: body size, `surface.sunken` block, 2px left rule in `line.boundary`.
- Load fonts with `next/font` (self-hosted, no runtime CDN call on stage).

## 4. Space, size, radius, elevation

- Space scale (px): `0 1 2 4 8 12 16 24 32 40 48 64 80 96`. Default gaps: 8 inside controls, 16
  inside cards, 24 between cards, 32 page margin.
- Radii: chips and plates `2`, controls `4`, cards `6`, drawers/dialogs `8`, pills `999`.
- Elevation: dark theme uses surface steps (default → raised), not shadows; light theme uses one
  shadow `0 1px 2px rgba(16,20,26,.06), 0 8px 24px rgba(16,20,26,.08)` for raised surfaces.
- Hit targets ≥ 24 px desktop (WCAG 2.2 target size), ≥ 40 px on touch layouts.

## 5. Layout

| Region | Size |
|---|---|
| Top bar | 48 px |
| Left rail | 56 px collapsed / 224 px expanded |
| Right inspector | 400 px (360–560 resizable) |
| Demo panel | 360 px, dashed `line.boundary` left edge, label "Demo controls" |
| Ask drawer | 440 px |
| Action bar (sticky in dialogs/cards) | 64 px |
| Content max width | 1600 px, gutter 24, margin 32 |
| Breakpoints | 768 / 1024 / 1280 / 1600 |

Stage resolution target: 1440×900 browser window at 100% zoom; nothing important below the fold on
Patients and Patient detail.

## 6. Motion

| Use | Duration | Easing |
|---|---|---|
| Press | 60 ms | standard |
| Hover | 80 ms | standard |
| Toggle, chip state | 120 ms | standard |
| Reveal (row expand, "Details") | 180 ms | conduct |
| Panel / inspector | 240 ms | conduct |
| Dialog | 320 ms | conduct in, exit out |
| New timeline event settle (highlight fades) | 900 ms | standard |

Easings: conduct `cubic-bezier(0.2, 0, 0, 1)`, exit `cubic-bezier(0.4, 0, 1, 1)`, standard
`cubic-bezier(0.3, 0, 0.2, 1)`. `prefers-reduced-motion`: replace movement with a 200 ms
cross-fade; no sliding.

## 7. Components

| Component | Purpose | Notes |
|---|---|---|
| `AppShell`, `TopBar`, `RailNav` | Frame | Top bar shows the sim clock with "(simulated)" |
| `UrgentBanner` | Pinned urgent escalations | `status.alert-strong`; "Acknowledge" button; one per screen |
| `StatusChip` | Lifecycle/todo/escalation status | word + icon + color; sizes sm/md |
| `LayerChip` | Rule source layer | "P0 · GOLD 2026 · COPD-3" (neutral), "P1 · Dr. Example" (info), "P2 · AI Plan" (Marker outline); "pending confirmation" suffix in caution until Faiz confirms |
| `PlaceholderToken` | Inline marker for unconfirmed clinical values | caution style, mono text "PLACEHOLDER · Faiz" |
| `ModelChip` | "Drafted by Claude" / "Extracted by Claude" / "Classified by Cortex" | Marker; text from the row's `model` field, never hard-coded |
| `SimulatedTag` | Simulated data | neutral outline, dash-dot border |
| `ConfidenceBand` | Model confidence | three cells + word (Low/Medium/High); thresholds from `APP.SETTINGS` |
| `KpiTile` | KPI tape | readout number, unit, label, "simulated" tag, click → Ask with the metric |
| `PatientTable` | Patients list | sticky header, keyboard row navigation, sortable |
| `TimelineEvent` | One audit event | actor glyph, time, line, chips, expandable inputs/outputs |
| `MessageQuote` | Verbatim patient-facing or patient-sent text | sunken block, "Sent via SMS · simulated" footer |
| `Sparkline` | Wearable window | series.1 line, dashed threshold, dash-dot because simulated |
| `StepCard` | Runbook step | type icon, trigger sentence, questions, branches as If/then rows, action |
| `BranchRow` | One rule | mono rule id, plain condition, arrow, target |
| `AiPlanQuote` | AI Plan line from the note | quoted line, P2 rules highlighted in Marker, mode Standard/Custom, rejected parts in alert |
| `ApprovalCard` | Queue item | evidence, rule + citation, draft + "Why:", Approve (primary) · Edit · Reject (reason required); disabled with tooltip when acting as Care agent |
| `ReasonDialog` | Reject, threshold edit, resolve | requires reason or statement (≥ 10 chars) |
| `EmptyState`, `ErrorState`, `StepLoader`, `FixtureBanner` | States | StepLoader label "Recording…" for writes |
| `AskDrawer` + `StepProgress` + `SqlDisclosure` | Ask | Understand · Query · Check · Answer |
| `DemoPanel` | Demo controls | dashed edge, collapsible, hidden in fixtures exports |

Buttons: primary = Ink fill with `text.on-ink` (one per screen); secondary = outline
`line.boundary`; tertiary = text. Destructive actions (Reset demo, Refer to ED) use an outline in
`status.alert` with a confirm dialog, never a filled red button.

## 8. Accessibility (WCAG 2.2 AA)
- Text contrast ≥ 4.5:1 (≥ 3:1 for ≥ 18.66 px bold / 24 px); control boundaries ≥ 3:1.
- Focus: 2 px Ink ring, 2 px offset, never removed; visible on every interactive element.
- Color is never the only carrier: status has a word and icon; charts label thresholds in text.
- All interactive components from `react-aria-components` (keyboard, ARIA roles, announcements).
- Live region announces new urgent escalations and demo actions ("Draft approved for SYN-011").
- Timeline is an ordered list with time as text, not only as position.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` (manual toggle overrides).

## 9. Voice and tone
- Calm, specific, blameless. "SYN-011 did not answer two check-in calls. Flagged for a clinician (ENG-4)."
  not "Patient non-compliant!".
- Sentence case, no exclamation marks, no emoji, no sparkle icons for AI.
- Name the actor and the basis: "Rule COPD-3 fired (GOLD 2026): 3 resting SpO2 readings ≤ 88 % in 14 days".
- Patient-facing text: grade 6 reading level, one instruction per message, always tells the patient
  how to reach a human.
