# CLI Application Skill

You are building a command-line application. Make it beautiful in the terminal and clean in logs.

## Language Selection

- **Go** — when a single static binary matters, when performance matters, when CGO_ENABLED=0 is important. Preferred for tools that get distributed.
- **Bun (TypeScript)** — when rapid prototyping matters, when the ecosystem is JS-heavy, when the tool is project-local.

**Default to Go** unless there's a clear reason for Bun.

## Go CLI Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| **CLI parsing** | [Cobra](https://github.com/spf13/cobra) | Commands, flags, completions, help |
| **TUI framework** | [Bubble Tea](https://github.com/charmbracelet/bubbletea) | For interactive/full-screen UIs |
| **Styling** | [Lipgloss](https://github.com/charmbracelet/lipgloss) | Terminal CSS — colors, borders, padding |
| **Components** | [Bubbles](https://github.com/charmbracelet/bubbles) | Pre-built: list, table, viewport, spinner, etc. |
| **Forms/prompts** | [Huh](https://github.com/charmbracelet/huh) | Multi-step forms, confirms, selects |
| **Config** | [Viper](https://github.com/spf13/viper) | YAML config + env vars |
| **Database** | [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite) | Pure Go SQLite, CGO=0 compatible |
| **Logging** | [log/slog](https://pkg.go.dev/log/slog) | Stdlib structured logging |
| **Pretty logging** | [charmbracelet/log](https://github.com/charmbracelet/log) | Colored stderr output for non-TUI subcommands |

### Build Rules

- **`CGO_ENABLED=0` always.** No C dependencies. No exceptions.
- All assets embedded via `//go:embed`
- Version via ldflags: `-X main.version={{.Version}} -X main.commit={{.ShortCommit}} -X main.date={{.Date}}`
- Dev mode (`version == "dev"`): debug logging, text format, serve from disk
- Production: JSON structured logging, embedded assets, info level

### Project Structure

```
cmd/<appname>/main.go          # Cobra root command, config, launch
internal/
  tui/
    app.go                     # Root Bubble Tea model (Model → Update → View)
    keys.go                    # Key bindings (vim-style: j/k/g/G, tab, ?, q)
    styles.go                  # Lipgloss styles with adaptive colors
    components/                # Panel, statusbar, dialog, tabs, filter
  config/config.go             # Viper, XDG paths
  <domain>/                    # Business logic
```

### TTY Detection — Critical

```go
import "golang.org/x/term"

if term.IsTerminal(int(os.Stdout.Fd())) {
    // Interactive: colors, TUI, pretty tables
} else {
    // Piped/redirected: plain text, JSON, CSV — no colors, no TUI
}
```

**Every subcommand must be scriptable.** If stdout isn't a terminal:
- Output plain text or structured data (JSON/CSV)
- No spinners, no progress bars, no color codes
- Exit codes: 0 = success, 1 = error, 2 = usage error

### Output Flags

- `--json` — machine-readable JSON output
- `--format` — `table` (default TTY), `json`, `csv`
- When piped (no TTY), default to CSV instead of table

### Interactive Decision Tree

1. **Static output** (list, version, status) → plain stdout, no Bubble Tea
2. **Interactive prompts** (confirmations, setup wizards) → Huh forms
3. **Full TUI** (primary experience) → Bubble Tea with alt screen

### Terminal UX Polish

- **Colors**: Lipgloss adaptive colors (work on light AND dark terminals). Accent: `#2563EB` / `#7AA2F7`
- **Borders**: Rounded via Lipgloss, multi-panel lazygit-style layouts
- **Status bar**: Bottom — mode indicator, key hints, version, update status
- **Vim navigation**: `j`/`k` up/down, `g`/`G` top/bottom, `/` search, `tab` cycle panels, `?` help, `q` quit
- **Command palette**: `:` opens fuzzy command search (like k9s)
- **Minimum terminal size**: Friendly message if too small, don't render garbled output
- **Crash recovery**: Deferred terminal restore on panic
- **Clipboard**: OSC52 (works over SSH) with `atotto/clipboard` fallback, bound to `y`

### Logging Strategy

- **TUI mode**: `log/slog` to file only — TUI owns stdout entirely. Log to `~/.local/state/<app>/app.log`
- **Non-TUI subcommands**: `charmbracelet/log` with colors to stderr
- **Piped/scripted**: Plain `slog` JSON to stderr
- **XDG paths**: Config `~/.config/<app>/`, data `~/.local/share/<app>/`, logs `~/.local/state/<app>/`

### Version Display

- `<app> --version` → `<appname> v1.2.3 (abc1234, 2025-01-15T10:30:00Z)`
- `<app> version` subcommand → full details including Go version and OS/arch
- TUI status bar (bottom-right) → `v1.2.3`
- When update available → `v1.0.5 (v1.1.0 available)` with `U` keybinding to update

## Bun CLI Stack

For TypeScript CLIs running under Bun:

- **CLI parsing**: Commander.js or yargs
- **Colors**: chalk (auto-detects TTY)
- **Spinners**: ora
- **Tables**: cli-table3
- **Prompts**: @inquirer/prompts

Same TTY detection principles apply — check `process.stdout.isTTY`.

## Taglines

CLI apps get taglines too:
- Show in `--version` output
- Show in TUI status bar (rotating)
- Show in `--help` header

## Error Handling

- Colored error messages with suggestions, not raw stack traces
- Exit code 1 for runtime errors, 2 for usage errors
- `slog.Error()` for logging, pretty formatted message for the user
- Include "did you mean...?" suggestions for misspelled commands/flags
