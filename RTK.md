# RTK - Rust Token Killer

Run shell commands directly by default. Use RTK for supported commands with
verbose output when a summary is enough, such as `rtk npm run build`. If a
hook already wraps a command, run it directly.

For scripts, diffs, and debugging, run the native command to get exact
output. If a hook would rewrite it, use `rtk bypass <command>`.

## Meta Commands

```bash
rtk gain            # Token savings analytics
rtk gain --history  # Recent command savings history
```

## Verification

```bash
rtk --version
rtk gain
which rtk
```
