# macOS App Store (optional)

This project can be packaged for the **Mac App Store** using Apple’s workflow and Tauri’s [App Store guide](https://v2.tauri.app/distribute/app-store/). The repo only contains **non-secret** templates; you keep signing material **out of git**.

## What is safe in a public repository

| OK to commit | Do **not** commit |
|--------------|-------------------|
| `Info.plist` merge (encryption export flag) | `.p12` / private keys / certificates |
| `Entitlements.appstore.example.plist` (placeholders) | `Entitlements.appstore.plist` with your real Team ID (optional: keep local only) |
| `tauri.appstore.conf.json` (paths only) | Provisioning profiles (`.provisionprofile`) |
| `bundle.category` | App Store Connect API key `AuthKey_*.p8` |
| Documentation | Passwords, `TAURI_SIGNING_PRIVATE_KEY`, any API tokens |

**Why:** Apple’s **Team ID** and **Bundle ID** are not secret like passwords; they appear inside signed apps anyway. What must stay private is anything that **proves identity to Apple** or **signs code** (private keys, `.p8`, distribution certificates, provisioning profiles are sensitive and revocable—treat them like production credentials).

## One-time local files (gitignored)

1. Copy the example entitlements and replace `YOUR_TEAM_ID`:

   ```bash
   cp src-tauri/Entitlements.appstore.example.plist src-tauri/Entitlements.appstore.plist
   ```

2. Download your **Mac App Store** provisioning profile from Apple Developer and save as:

   `desktop/src-tauri/MacAppStore.provisionprofile`

3. Ensure the profile’s App ID matches `identifier` in `tauri.conf.json` (`com.orateur.desktop`).

## Build (on a Mac)

Commands follow the [official flow](https://v2.tauri.app/distribute/app-store/): build the app bundle, then create a signed `.pkg` and upload with `altool` and an App Store Connect API key.

Example merge (from `desktop/`):

```bash
npm run tauri build -- --no-bundle
npm run tauri bundle -- --bundles app --target universal-apple-darwin --config src-tauri/tauri.appstore.conf.json
```

Then use `xcrun productbuild` and `xcrun altool` as in Tauri’s documentation. **Code signing** identities are chosen via your Keychain / CI secrets, not checked into the repo.

## Compatibility warning

This app uses **macOS private APIs**, overlay windows, and a **GitHub-based updater** in normal release builds. The **App Store** requires **App Sandbox** and has different rules for updates (often **no** custom GitHub updater inside the MAS build). Expect **extra entitlements**, **review constraints**, and possibly **product changes** before Apple accepts the app. The `tauri.appstore.conf.json` merge disables **`createUpdaterArtifacts`** for that flavor so you are not publishing updater metadata meant for GitHub releases.
