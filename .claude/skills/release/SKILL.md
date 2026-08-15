---
name: release
description: Publish a new Album release — bump version, rebuild both installers, verify no personal data leaked into the build, then create a GitHub Release with the .exe assets. User-invoked only (it publishes publicly). Use when the user says "release", "publish a new version", "wypchnij nową wersję", or similar.
disable-model-invocation: true
allowed-tools: Bash, PowerShell, Read, Edit, Glob, Grep, Agent
---

# Release Album

Publishes a new version to the public repo (github.com/zetmar-collab/album). This is the exact sequence that was done manually the first time — including the step that was almost skipped: verifying the build doesn't contain stale personal data.

**Never skip the privacy check.** An earlier release build shipped with the maintainer's email baked into `main.js`'s User-Agent string because the .exe was built before a source cleanup — it looked done, but wasn't rebuilt after the fix. Don't repeat that.

## Steps

1. **Preconditions**: `git status` must be clean (no uncommitted changes) before starting. If dirty, stop and tell the user — don't auto-commit unrelated work into a release.

2. **Determine the version bump.** Look at what changed since the last tag (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`). If it's not obvious whether this is patch/minor/major, ask the user — don't guess silently on a public release.

3. **Bump `package.json`** `version` field to the new version.

4. **Rebuild and smoke-test**: invoke the `rebuild-test` skill (or run its steps directly) with the new version. Do not proceed if the build or smoke tests fail.

5. **Run the privacy-auditor subagent** against the fresh build and the diff before doing anything public:
   ```
   Agent({
     description: "Pre-release privacy audit",
     subagent_type: "privacy-auditor",
     prompt: "Audit the Album repo (project root) for leaked personal data before release vX.Y.Z. Check the git diff since the last tag AND extract+scan dist/win-unpacked/resources/app.asar (just rebuilt). Report pass/fail per category."
   })
   ```
   If it reports any finding, stop and fix it (then re-run steps 4-5) before continuing. Do not publish on a "probably fine" — the whole point of this step is to not trust that.

6. **Commit the version bump**:
   ```bash
   git add package.json
   git commit -m "Bump version to vX.Y.Z"
   git tag vX.Y.Z
   ```

7. **Push**:
   ```bash
   git push origin master --follow-tags
   ```

8. **Create the GitHub Release** with both built assets:
   ```bash
   gh release create vX.Y.Z \
     "dist/Album-X.Y.Z-portable.exe#Album-X.Y.Z (wersja przenośna, bez instalacji)" \
     "dist/Album-X.Y.Z-instalator.exe#Album-X.Y.Z (instalator)" \
     --title "Album X.Y.Z" \
     --notes "<summarize what changed since the last tag, in Polish, matching the tone of prior release notes>"
   ```

9. **Confirm**: `gh release view vX.Y.Z --json assets` and report the release URL and asset sizes back to the user.

## Notes

- This skill is `disable-model-invocation: true` — only the user can trigger it directly, never invoked automatically by Claude mid-conversation, since it has irreversible public side effects (git push, public release).
- If the user only wants a local build without publishing, use `rebuild-test` instead.
