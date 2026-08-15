---
name: rebuild-test
description: Rebuild the Album Windows app (portable .exe) after source changes and smoke-test it end to end — phone server up, barcode search, photo barcode decoding. Use after editing main.js, preload.js, or renderer/*, or whenever the user says "rebuild and test" / "sprawdź czy działa".
allowed-tools: Bash, PowerShell
---

# Rebuild & smoke-test Album

Repeats the manual cycle used throughout development: stop the running instance, rebuild, launch, verify the phone-scan endpoints actually respond. Runs on Windows; use PowerShell for process control, Bash/curl for HTTP checks — both are available.

## Steps

1. **Stop any running instance** (ignore errors if nothing is running):
   ```powershell
   try { Stop-Process -Name Album -Force -ErrorAction Stop } catch {}
   try { Stop-Process -Name electron -Force -ErrorAction Stop } catch {}
   ```

2. **Build** (from the project root, `%CD%`):
   ```powershell
   npx electron-builder --win
   ```
   Watch the output for errors. If it fails, stop here and report the error — do not proceed to launch.

3. **Launch the portable build**:
   ```powershell
   Start-Process "%CD%\dist\Album-1.0.0-portable.exe"
   ```
   (Match the actual version in `dist/` — check `package.json` version if unsure.)

4. **Wait for the phone server** (port 8137) and run smoke tests:
   ```bash
   until curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:8137/ | grep -q 200; do sleep 3; done
   echo "SERVER-OK"

   # Known-good test barcode: Daft Punk - Homework (both UPC/EAN variants exist in the wild)
   curl -s --max-time 30 -X POST http://127.0.0.1:8137/api/barcode \
     -H "Content-Type: application/json" -d '{"barcode":"724384260958"}'
   ```
   Expect `{"ok":true, ...}` with `found` > 0.

5. **Optional: photo-decode test** (only if zxing-wasm or the photo-upload path changed). Generate a test barcode PNG and POST it:
   ```bash
   node -e "require('qrcode').toFile('<scratchpad>/test-code.png','5099749534728',{width:400},()=>console.log('ok'))"
   curl -s --max-time 30 -X POST http://127.0.0.1:8137/api/photo -F "photo=@<scratchpad>/test-code.png"
   ```
   Expect `{"ok":true,"barcode":"5099749534728", ...}`.

6. **Report** pass/fail for each step plainly — don't just say "done", state what was actually verified (e.g. "server responded, barcode search returned 3 results from MusicBrainz+Discogs").

## Notes

- Use `run_in_background: true` for the build and for the `until curl...` wait loop — both can take 15-60s, and you don't want to block on them synchronously.
- If the build was already fresh and only a quick functional check is needed, steps 1-3 can be skipped — just confirm the running instance's server responds (step 4).
- This does **not** publish anything. For that, use the `release` skill, which calls this one first.
