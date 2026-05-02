# Auto-Update Skill

You are implementing in-app update checking and self-update for a Go application. The trust chain uses Sigstore cosign for supply chain security.

## Trust Chain

```
GoReleaser builds → cosign signs checksums.txt via GitHub OIDC
→ client downloads checksums.txt + checksums.txt.sigstore.json
→ client verifies sigstore bundle (Fulcio CA + Rekor transparency log)
→ client verifies binary SHA256 against signed checksums
→ client replaces binary
```

## Update Check (Non-Blocking)

On startup, spawn a goroutine that:

1. Skip if `version == "dev"` (development build)
2. Skip if running in Docker (check `/.dockerenv` or `container` cgroup)
3. Query GitHub Releases API: `GET https://api.github.com/repos/jclement/<project>/releases/latest`
4. Compare `tag_name` against current version using semver
5. If newer exists, store result for UI display

```go
// internal/updater/check.go
type CheckResult struct {
    CurrentVersion  string
    LatestVersion   string
    UpdateAvailable bool
    ReleaseURL      string  // GitHub release page
    DownloadURL     string  // Platform-specific binary
    ChecksumURL     string  // checksums.txt
    BundleURL       string  // checksums.txt.sigstore.json
}
```

**Timeout:** 10 seconds for the check — never block startup.

## Surfacing Updates

### Web Applications
- `GET /api/v1/health` returns `{"status":"ok","version":"v1.2.3","update_available":"v1.3.0"}` (or omit field if current)
- UI footer shows version; when update available: `v1.0.5 (v1.1.0 available — upgrade)` with a link
- Admin-only "Update" button that triggers `POST /api/v1/admin/update`
- After update: graceful shutdown (let systemd/supervisor restart the process)

### CLI / TUI Applications
- `--version` output includes update notice
- TUI status bar: `v1.0.5 (v1.1.0 available)` with `U` keybinding
- `<appname> update` subcommand for manual update
- On startup, log: `slog.Warn("update available", "current", version, "latest", latest)`

## Self-Update with Sigstore Verification

Use [`sigstore-go`](https://github.com/sigstore/sigstore-go) for verification. This handles TUF root of trust, Fulcio CA verification, and Rekor transparency log checks.

### Update Flow

```go
// internal/updater/update.go

func SelfUpdate(result *CheckResult, repo string) error {
    // 1. Refuse if Docker
    if isDocker() {
        return fmt.Errorf("self-update not supported in Docker — pull a new image instead")
    }

    // 2. Download checksums.txt and checksums.txt.sigstore.json
    checksums, err := download(result.ChecksumURL)
    bundle, err := download(result.BundleURL)

    // 3. Verify sigstore bundle
    //    - Pin certificate identity to: https://github.com/jclement/<repo>/
    //    - Pin OIDC issuer to: https://token.actions.githubusercontent.com
    //    - This prevents supply chain attacks — DO NOT relax these checks
    err = verifySigstoreBundle(checksums, bundle, repo)

    // 4. Download platform-specific binary
    binary, err := download(result.DownloadURL)

    // 5. Verify SHA256 against signed checksums
    err = verifyChecksum(binary, checksums, assetName())

    // 6. Write to temp file in same directory as current binary
    //    (same filesystem = atomic rename)
    tmpPath := writeTempFile(binary)

    // 7. chmod 0755
    os.Chmod(tmpPath, 0o755)

    // 8. Atomic rename to replace current binary
    os.Rename(tmpPath, executablePath())

    return nil
}
```

### Sigstore Verification Details

```go
import (
    "github.com/sigstore/sigstore-go/pkg/bundle"
    "github.com/sigstore/sigstore-go/pkg/verify"
    "github.com/sigstore/sigstore-go/pkg/root"
)

func verifySigstoreBundle(checksumData, bundleData []byte, repo string) error {
    // Load the sigstore bundle
    b, err := bundle.LoadBundle(bundleData)

    // Get trusted root from Sigstore TUF
    trustedRoot, err := root.FetchTrustedRoot()

    // Build verifier with certificate identity pinning
    certID, err := verify.NewShortCertificateIdentity(
        "https://token.actions.githubusercontent.com",      // OIDC issuer
        "",                                                   // (no san regex)
        fmt.Sprintf("https://github.com/jclement/%s/", repo), // cert identity
    )

    verifierConfig := []verify.VerifierOption{
        verify.WithSignedCertificateTimestamps(1),
        verify.WithTransparencyLog(1),
    }

    sev, err := verify.NewSignedEntityVerifier(trustedRoot, verifierConfig...)

    // Verify the bundle against the checksums data
    _, err = sev.Verify(b, verify.NewPolicy(
        verify.WithArtifact(bytes.NewReader(checksumData)),
        verify.WithCertificateIdentity(certID),
    ))

    return err
}
```

### Security Rules — Non-Negotiable

1. **Never skip signature verification** (except `version == "dev"` where updates are disabled anyway)
2. **Never relax certificate identity pinning** — repo URL + GitHub OIDC issuer is the supply chain protection
3. **Validate download URLs** — must be HTTPS from `github.com` or `objects.githubusercontent.com`
4. **Cap download size** — 256 MiB max to prevent disk exhaustion
5. **Atomic replacement** — write to temp file in same directory, then rename

### Backwards Compatibility

Support both:
- New protobuf-based sigstore bundle format (`.sigstore.json`)
- Older cosign detached signature format (`.sig`)

Fall back gracefully if the bundle isn't available (older releases before signing was added).

## Docker Detection

```go
func isDocker() bool {
    if _, err := os.Stat("/.dockerenv"); err == nil {
        return true
    }
    // Also check cgroup for container runtime
    data, err := os.ReadFile("/proc/1/cgroup")
    if err == nil && (strings.Contains(string(data), "docker") || strings.Contains(string(data), "containerd")) {
        return true
    }
    return false
}
```

When in Docker, the update UI shows: "Running in Docker — update by pulling a new image: `docker pull ghcr.io/jclement/<app>:latest`"

## Web Application Update Button

For web apps, add an admin-only endpoint:

```go
// POST /api/v1/admin/update — admin only
// 1. Check for update
// 2. Download, verify, replace binary
// 3. Respond with success
// 4. Trigger graceful shutdown (os.Exit(0) after draining connections)
// 5. Let process manager (systemd, Docker) restart the new binary
```

The frontend shows a button in Settings (admin only) when an update is available, with the version diff and a "Update now" action.
