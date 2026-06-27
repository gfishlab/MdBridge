# Git History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build MdBridge v2.0.0 Git document history for local Git-backed Markdown workspaces.

**Architecture:** Add a Rust `git_integration` module for CLI-backed Git operations and expose focused Tauri commands. Add a React `GitPanel` side panel and a bottom status-bar entry in `App.tsx`.

**Tech Stack:** Tauri 2, Rust `std::process::Command`, React 18, TypeScript, Vitest, Cargo tests.

---

### Task 1: Backend Git Data Layer

**Files:**
- Create: `src-tauri/src/git_integration.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [x] Add failing Rust tests for status, branch and log parsing.
- [x] Implement structured Git types: `GitStatus`, `GitCommit`, `GitBranch`, `GitOperationResult`.
- [x] Implement Git CLI helpers with `GIT_TERMINAL_PROMPT=0`.
- [x] Expose Tauri commands for status, branches, current-file history, diff, restore, commit, pull and push.
- [x] Verify with `cargo test --manifest-path src-tauri/Cargo.toml git_integration -- --nocapture`.

### Task 2: Frontend Git Panel

**Files:**
- Create: `src/components/GitPanel/GitPanel.tsx`
- Create: `src/components/GitPanel/GitPanel.css`
- Create: `src/components/GitPanel/index.ts`
- Create: `src/components/GitPanel/GitPanel.test.tsx`

- [x] Add failing component tests for loading repository data, showing diff, restoring a revision and committing the current document.
- [x] Implement `GitPanel` with loading, empty and error states.
- [x] Wire restore, commit, pull and push actions to Tauri commands.
- [x] Verify with `npm test -- src/components/GitPanel/GitPanel.test.tsx`.

### Task 3: App Integration

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/App.test.tsx`

- [x] Add failing integration test for opening the Git version panel from the status bar.
- [x] Add status-bar version entry with branch and modified-file count.
- [x] Render `GitPanel` as a left-side panel.
- [x] Flush pending editor saves before Git actions.
- [x] Synchronize restored historical content back into the active document tab.
- [x] Verify with `npm test -- src/App.test.tsx -t "opens the Git version panel"`.

### Task 4: Release Metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [x] Bump npm, Cargo and Tauri versions to `2.0.0`.
- [x] Document Git version history in README.
- [x] Add v2.0.0 changelog entries.

### Task 5: Verification and Release

- [x] Run `npm test`.
- [x] Run `npm run test:rust`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run local Tauri package check. App and DMG artifacts were generated; local updater signing stopped because `TAURI_SIGNING_PRIVATE_KEY` is not present on this machine. GitHub Actions release uses repository secrets for signing.
- [ ] Commit the v2.0.0 changes.
- [ ] Tag `v2.0.0`.
- [ ] Push commit and tag to trigger release workflow.
