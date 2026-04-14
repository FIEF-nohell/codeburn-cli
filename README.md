# CodeBurn

See where your AI coding tokens go.

## Install

```bash
npm install -g codeburn
```

Or run without installing:

```bash
npx codeburn
```

Requires Node.js 20+ and Claude Code (`~/.claude/projects/` session data).

## Usage

```bash
codeburn                    # interactive dashboard (default: 7 days)
codeburn today              # today's usage
codeburn month              # this month's usage
codeburn report -p month    # same as above
codeburn status             # compact one-liner (today + month)
codeburn status --format json
codeburn export             # CSV with today, 7 days, 30 days
codeburn export -f json     # JSON export
```

Keyboard: arrow keys or `1`/`2`/`3`/`4` to switch periods, `r` to toggle auto-refresh, `q` to quit.

## Menu Bar (macOS)

```bash
codeburn install-menubar    # install SwiftBar/xbar plugin
codeburn uninstall-menubar  # remove it
```

Requires [SwiftBar](https://github.com/swiftbar/SwiftBar) (`brew install --cask swiftbar`).

## License

MIT

## Credits

Inspired by [ccusage](https://github.com/ryoppippi/ccusage). Pricing data from [LiteLLM](https://github.com/BerriAI/litellm). Originally built by [AgentSeal](https://agentseal.org).
