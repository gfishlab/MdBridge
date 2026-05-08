# MDBridge Auto Update Release

MDBridge uses the Tauri v2 updater with signed update artifacts. Keep the private key out of git.

## Local signing key

The updater public key is committed in `src-tauri/tauri.conf.json`.

The private key is stored locally at:

```sh
~/.tauri/mdbridge-updater.key
```

Back this file up securely. If it is lost, existing installations cannot verify future update packages.

## Build a signed release

```sh
TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/mdbridge-updater.key")" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
npm run tauri build
```

With `bundle.createUpdaterArtifacts` enabled, Tauri creates updater archives and matching `.sig` files under:

```sh
src-tauri/target/release/bundle/
```

On macOS the updater artifact is typically:

```sh
src-tauri/target/release/bundle/macos/MDBridge.app.tar.gz
src-tauri/target/release/bundle/macos/MDBridge.app.tar.gz.sig
```

## Generate `latest.json`

After the signed build:

```sh
npm run release:latest -- --version 0.1.5 --tag v0.1.5 --notes "MDBridge v0.1.5"
```

This writes:

```sh
release/latest.json
```

Upload `latest.json`, the updater archive, the `.sig` file, and the user-facing installer such as `.dmg` to the GitHub Release.

The app checks:

```txt
https://github.com/gfishlab/MdBridge/releases/latest/download/latest.json
```

## End-to-end verification

1. Install the previous release.
2. Publish a newer GitHub Release with `latest.json` and signed updater artifacts.
3. Open the old app.
4. Confirm the update dialog appears.
5. Click `立即更新`.
6. Confirm the app restarts into the new version.
