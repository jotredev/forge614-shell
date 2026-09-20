# Public installer and manual update design

## Goal

Allow any macOS or Linux user to install the latest public stable Forge614 Shell release with one command, then update later with a short native command. Shell automatically installs a compatible Forge614 Engines release when it is missing or incompatible; Engines remains an internal dependency and is never added to the user's PATH. The project source and GitHub Releases are public. The maintainer retains responsibility for version bumps, tags, GitHub Release publication, and asset uploads.

## User experience

First installation:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

The installer downloads the latest stable release, verifies its checksum, installs it under `~/.forge614`, configures the command path once, and tells the user to reopen Terminal.

Later update:

```bash
forge614-shell update
```

The command downloads and verifies the latest stable release, switches the active executable to it, and tells the user to restart Forge614 Shell. No background or silent updates occur.

## Scope

- macOS and Linux only.
- Public GitHub Releases are the distribution host.
- Node.js remains a prerequisite.
- Git, GitHub CLI, Bun, cloning the repository, npm publication, a custom domain, Windows support, and automatic updates are out of scope.
- Existing archive installation remains supported for local testing and manual release downloads:

  ```bash
  bash install.sh --archive forge614-shell-<version>.tar.gz
  ```

## Distribution contract

Every stable GitHub Release must attach these assets with these exact names:

1. `forge614-shell-<version>.tar.gz`
2. `forge614-shell-<version>.tar.gz.sha256`
3. `install.sh`

`install.sh` is both the release asset addressed by `releases/latest/download/install.sh` and the installer implementation. It must work with no arguments for public installation and with `--archive <path>` for an explicit local archive.

The installer uses the GitHub Releases API to resolve the numeric tag and the matching versioned archive/checksum URLs. It must not infer an archive name from an untrusted release title.

## Components and data flow

1. **Release publisher:** manually creates the package archive and checksum, creates/pushes the numeric tag, then uploads all three assets to the matching public GitHub Release.
2. **Remote installer (`install.sh`):** when called without arguments, fetches the latest release metadata with `curl`, parses only the required asset URLs with the already-required Node.js runtime, downloads archive and checksum into a temporary directory, verifies the archive, and hands the verified archive to the existing local installation path.
3. **Engines bootstrap:** before activating Shell, checks `~/.forge614/engines/bin/forge614-engines` by running its read-only `detect` contract and validating the supported schema version. If absent or incompatible, downloads Engines' own published installer, which verifies its platform archive checksum and installs only under `~/.forge614/engines/`.
4. **Local Shell installation path:** validates archive layout, installs the version under `~/.forge614/shell/<version>`, atomically moves the active `~/.forge614/shell/bin/forge614-shell` symlink, and appends one idempotent PATH line to the selected shell profile.
5. **Update command:** `forge614-shell update` delegates to the installed updater entry point, which invokes the public installer. It must never treat `update` as an AI prompt.

## Installation and update behavior

- First installation creates `~/.forge614/shell/bin/forge614-shell` and makes it available in new Terminal sessions.
- An update keeps previous version directories intact and only repoints the active symlink after the new archive is fully downloaded, verified, and installed.
- Re-running installation of the same version is safe and does not add another PATH line.
- A compatible Engines binary is reused without downloading another copy; an absent or incompatible one is installed automatically before Shell is activated.
- Shell never adds Engines to `PATH`; sibling products call its owned launcher at `~/.forge614/engines/bin/forge614-engines`.
- `forge614-shell --version` always reports the active installed version.
- `forge614-shell update` must report whether it installed a newer version or the user already has the latest version.

## Failure behavior

The public installer exits non-zero and gives a direct English error when:

- the operating system is unsupported;
- `curl`, Node.js, `tar`, or a SHA-256 verifier is unavailable;
- GitHub cannot be reached or returns no published stable release;
- a required asset is missing;
- the checksum fails;
- Engines cannot be downloaded, installed, or validated against the supported schema;
- the archive layout is invalid.

In all failure cases, it must remove temporary downloads and leave the previously active version untouched.

## Security boundaries

- Downloads use HTTPS GitHub endpoints.
- The archive checksum detects corruption during transport. It does not replace GitHub account security or signed release provenance.
- The installer reads release asset URLs from the GitHub API and verifies that the selected archive/checksum names match the numeric tag.
- Engines verifies its own platform-specific archive checksum before Shell accepts its read-only schema response.
- It never requires root privileges and writes only to the user profile and `~/.forge614`.

## Tests

Automated tests must cover:

1. Existing explicit-archive installation still works and configures PATH once.
2. Public installer resolves a synthetic latest-release response, downloads matching archive/checksum, and installs it.
3. A checksum mismatch leaves the old active executable unchanged.
4. `forge614-shell update` invokes the updater path rather than starting an AI session.
5. Re-running an update with the active latest version reports no change and preserves one PATH configuration line.
6. A missing Engines installation is bootstrapped before Shell activation; a compatible existing Engines installation is reused without any download.

Manual release acceptance test:

1. From a clean macOS/Linux user profile, run the public `curl` command.
2. Reopen Terminal and run `forge614-shell --version`.
3. Publish a later patch release, run `forge614-shell update`, then verify the reported version changed.

## Publication responsibility

Implementation prepares the scripts, tests, and local release bundle only. The maintainer manually bumps the version, creates the Git tag, publishes the GitHub Release, and uploads its three assets.
