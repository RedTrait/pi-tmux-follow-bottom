# pi-tmux-follow-bottom

Keep [pi](https://pi.dev) visible at the bottom inside `tmux` by refreshing the tmux client after pi output events.

## Why

When pi runs inside tmux, mouse scrolling can leave the tmux client viewport in scrollback/copy-mode. In that state, new pi output may continue streaming, but the visible client viewport can remain above the latest content until you manually jump back to the bottom.

This extension listens to pi output-related events and runs:

```bash
tmux refresh-client -D 999999
```

That asks tmux to move the client viewport back to the bottom after pi renders new output.

## Features

- Event-driven; no background polling loop.
- Works only when pi is running inside tmux.
- Coalesces high-frequency streaming updates to avoid excessive tmux refresh calls.
- Handles assistant streaming, tool streaming, final message renders, and turn-end status updates.
- Requires no custom tmux keybinding.

## Requirements

- pi coding agent
- tmux
- Node.js environment supported by pi extensions

This package is useful only inside tmux. Outside tmux, it does nothing.

## Installation

### From npm

```bash
pi install npm:pi-tmux-follow-bottom
```

### From GitHub

```bash
pi install git:github.com/RedTrait/pi-tmux-follow-bottom
```

### From a local checkout

```bash
git clone https://github.com/RedTrait/pi-tmux-follow-bottom.git
pi install /absolute/path/to/pi-tmux-follow-bottom
```

After installation, restart pi or run:

```text
/reload
```

## Configuration

The extension supports two environment variables.

### `PI_TMUX_FOLLOW_MIN_INTERVAL_MS`

Minimum time between tmux refresh calls.

Default:

```bash
120
```

Example:

```bash
export PI_TMUX_FOLLOW_MIN_INTERVAL_MS=200
```

Use a larger value if you want fewer `tmux refresh-client` calls during fast streaming.

### `PI_TMUX_FOLLOW_DELAY_MS`

Delay after a pi event before refreshing tmux.

Default:

```bash
25
```

Example:

```bash
export PI_TMUX_FOLLOW_DELAY_MS=50
```

A short delay gives pi time to render the update before tmux moves the viewport back to the bottom.

## Behavior notes

This extension intentionally prioritizes following the latest output. If you scroll up while pi is actively streaming, the next pi output event can pull the tmux client viewport back to the bottom.

If you want to read history without being pulled back, wait until pi stops streaming, or disable the extension with:

```bash
pi config
```

## How it works

The extension subscribes to these pi events:

- `message_update`
- `tool_execution_update`
- `message_end`
- `tool_execution_end`
- `turn_end`

After an event, it schedules a throttled tmux refresh:

```bash
tmux refresh-client -D 999999
```

The extension ignores refresh errors so it is safe to load outside tmux or in detached sessions.

## Recommended tmux setup

This extension does not require special tmux configuration, but pi itself recommends enabling extended keys:

```tmux
set -g extended-keys on
set -g extended-keys-format csi-u
```

For modern terminals, `tmux-256color` is usually preferable to `screen-256color`:

```tmux
set -g default-terminal "tmux-256color"
```

## Recording a comparison video for GitHub

A good comparison video should show:

1. pi running inside tmux without this extension.
2. Scroll up with the mouse while pi is producing output.
3. Show that the viewport does not reliably return to the latest output.
4. Enable this extension.
5. Repeat the same test and show the viewport following the bottom after output events.

### Option A: Record with OBS Studio

OBS is the easiest option for GitHub-ready MP4 videos.

1. Install OBS Studio.
2. Create a scene with a window capture for your terminal.
3. Set output format to MP4 or MKV.
4. Record two clips:
   - `before.mp4`
   - `after.mp4`
5. Keep each clip short, ideally under 30 seconds.
6. Upload the MP4 files to a GitHub release, issue, pull request, or `docs/` directory.

You can reference the video in README with a link:

```markdown
[Before/after demo](https://github.com/RedTrait/pi-tmux-follow-bottom/assets/.../demo.mp4)
```

If you upload the video by dragging it into a GitHub issue or PR comment, GitHub will generate a stable asset URL that you can copy into the README.

### Option B: Record terminal demos with VHS

[VHS](https://github.com/charmbracelet/vhs) records scripted terminal demos and exports GIF/MP4.

Install VHS, then create a tape file such as `demo.tape`:

```tape
Output demo.mp4
Set Shell bash
Set FontSize 18
Set Width 1280
Set Height 720

Type "tmux new -A -s pi-demo"
Enter
Sleep 1s
Type "pi"
Enter
Sleep 2s
# Continue with a scripted prompt or manual recording steps.
```

Run:

```bash
vhs demo.tape
```

VHS is best for scripted demos. OBS is usually better if you need to show mouse scrolling inside tmux.

### Option C: Record with asciinema plus agg

For a terminal-only recording:

```bash
asciinema rec demo.cast
```

Then convert to GIF with [`agg`](https://github.com/asciinema/agg):

```bash
agg demo.cast demo.gif
```

This is lightweight, but it does not capture mouse behavior as clearly as OBS.

## Publishing

### Publish to npm

```bash
npm login
npm publish
```

Users can then install it with:

```bash
pi install npm:pi-tmux-follow-bottom
```

### Publish through GitHub

Push tags for stable installs:

```bash
git tag v0.1.0
git push origin main --tags
```

Users can install the tagged version with:

```bash
pi install git:github.com/RedTrait/pi-tmux-follow-bottom@v0.1.0
```

## License

MIT
