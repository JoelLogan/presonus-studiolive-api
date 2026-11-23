# Releasing the Add-on

Home Assistant doesn't build this add-on on the device. It pulls a ready-made image from GitHub Container Registry (GHCR), named by `image` in `config.json`:

```
ghcr.io/joellogan/{arch}-addon-presonus-studiolive:<version>
```

The images are built by the **Add-on** workflow (`.github/workflows/addon.yml`).

## What the workflow does

On every push and pull request, for both `amd64` and `aarch64` (built natively on an ARM runner):

1. Lints and builds the library.
2. Runs the end-to-end test (`addon/test/e2e.js`): the add-on server against a fake mixer and an MQTT broker.
3. Builds the add-on image.
4. Runs the same end-to-end test against the built image.

On pushes to `master` only, it also publishes the image as `:<version>` and `:latest`. If that version is already published, it skips publishing with a warning instead of overwriting it.

## Releasing a new version

1. Make your changes and add a section to `CHANGELOG.md`.
2. Bump `version` in `config.json`. Home Assistant only offers an update when this changes, and the workflow won't publish a version that already exists.
3. Merge to `master`.
4. Wait for the **Add-on** workflow to finish (Actions tab). Both "Build amd64" and "Build aarch64" must be green.
5. In Home Assistant: Settings → Add-ons → Add-on Store → ⋮ → **Check for updates**, then update the add-on.

Don't bump the version in Home Assistant before the workflow has finished. Home Assistant would try to pull an image that doesn't exist yet and the update would fail (retrying later works).

## First-time setup: make the images public

GHCR packages are usually created as **private**, and Home Assistant can't pull private images. After the first successful publish:

1. Go to your GitHub profile → **Packages**.
2. Open `aarch64-addon-presonus-studiolive` → **Package settings** → **Change visibility** → **Public**.
3. Do the same for `amd64-addon-presonus-studiolive`.

This is needed only once per package.

## Building and testing locally

```bash
npm ci --ignore-scripts && npm run build      # library
cd addon && npm ci && npm test                # end-to-end test against the server
docker build -t presonus-addon:test ..        # image (from the repository root context)
E2E_DOCKER_IMAGE=presonus-addon:test npm test # end-to-end test against the image
```
