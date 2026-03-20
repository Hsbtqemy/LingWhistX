# Release Checklist v1

Local release checklist for WhisperX Studio (Windows desktop, no Docker).

## 1. Preconditions

1. Start from `main` and ensure working tree is clean.
2. Confirm `Node.js`, `npm`, `rustc`, `cargo`, `Python 3.10+`, and `ffmpeg` are available.
3. Run `npm ci` at project root.

## 2. Smoke + Build

1. Run `npm run smoke:e2e`.
2. Wait for `Smoke report:` output and open the generated file in `runs/smoke/`.
3. Confirm the report status is `success`.

## 3. Artifact Verification

1. Confirm MSI path is present in report (`src-tauri/target/release/bundle/msi/*.msi`).
2. Confirm EXE path is present in report (`src-tauri/target/release/bundle/nsis/*.exe`).
3. Confirm SHA256 hashes are present for MSI and EXE.
4. Keep the report file as release traceability evidence.

## 4. Publish

1. Commit release changes and push to `origin/main`.
2. Tag release (`git tag vX.Y.Z` then `git push origin vX.Y.Z`).
3. Attach MSI, EXE, and smoke report to release notes.

## 5. Rollback Criteria

1. Any failed smoke step.
2. Missing MSI or EXE artifact.
3. Missing hashes in smoke report.
