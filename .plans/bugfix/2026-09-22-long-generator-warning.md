# Task: Stop the `config_file_contents` generator warning dominating the dashboard

**Status:** ACTIVE
**Branch:** giga-usf-dashboard
Companion (pipeline side): `panther_build/.plans/2026-09-22-config-contents-warning-summary.md`

## Goal
The warning "config `config_file_contents` changed during this build: `<whole config.mk>` → `<whole
config.mk>`" (~10 KB, many lines, on the live report) takes up a lot of space and is the most
noticeable thing in the checks list. It should stay visible (it's a real generator warning) but
be minimised.

## Root cause
`panther_build/scripts/build_state_collectors/config_ledger.py:41-48` builds one warning per
changed ledger key as `` f"config `{key}` changed during this build: `{a}` → `{b}`" ``. For
`config_file_contents` both values are the full multi-line config.mk text.

## Design
Two layers, both needed: the live report already carries the long message, and future reports
shouldn't produce it.

1. **Pipeline (root cause):** for a multi-line value (today only `config_file_contents`), emit a
   one-line summary instead of both texts: which lines were added or removed, counted, pointing
   at the Build configuration section. Put the unified diff (`difflib.unified_diff`, first → current)
   in the section's `text` as a fenced ```diff block, after the existing config.mk block. The
   single-line keys keep their current message verbatim.
2. **Dashboard (display):** generator warnings are quoted verbatim, and that stays. A message
   that is multi-line or longer than a threshold (~240 chars) renders collapsed by default:
   - the first line, clipped, plus a "Show full message" toggle (Mantine `Collapse`/the
     `Disclosure` component);
   - full text in a mono, scrollable, max-height block when expanded.
   This goes wherever generator warning text is rendered: check rows, inline/phase markers
   and the unattached-warnings list. Find the render sites, don't guess. Search/export keep the
   full text.
   If long generator warnings sort to the top of the checks list only because of how `runChecks.ts`
   orders findings, and not by severity, record why in the report. Don't reorder unless the ordering is plainly
   accidental.

## Steps
- [ ] Pipeline: config_ledger summary + diff block, tests in tests/test_build_state.py
- [ ] Dashboard: collapsed long-warning rendering, tests; message text unchanged in the model
