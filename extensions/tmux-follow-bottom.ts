import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Minimum time between tmux refresh calls.
 *
 * Assistant token streaming can emit many updates per second. Refreshing tmux
 * on every token is unnecessary, so this value coalesces bursts of events.
 */
const MIN_INTERVAL_MS = Number(process.env.PI_TMUX_FOLLOW_MIN_INTERVAL_MS ?? 120);

/**
 * Delay before refreshing tmux after a pi event.
 *
 * pi schedules TUI rendering asynchronously. A short delay gives pi time to
 * render the update before tmux is asked to move the client viewport back to
 * the bottom.
 */
const DELAY_AFTER_EVENT_MS = Number(process.env.PI_TMUX_FOLLOW_DELAY_MS ?? 25);

export default function (pi: ExtensionAPI) {
  let lastRun = 0;
  let timer: NodeJS.Timeout | undefined;

  function isInsideTmux(): boolean {
    return Boolean(process.env.TMUX);
  }

  function runTmuxRefresh(): void {
    execFile("tmux", ["refresh-client", "-D", "999999"], { timeout: 1000 }, () => {
      // Intentionally ignore errors. The command can fail when tmux is not
      // available, the client has detached, or the extension is used outside
      // of an interactive tmux session.
    });
  }

  function scheduleRefreshBottom(): void {
    if (!isInsideTmux()) return;

    const now = Date.now();
    const elapsed = now - lastRun;

    if (elapsed < MIN_INTERVAL_MS) {
      if (!timer) {
        timer = setTimeout(() => {
          timer = undefined;
          scheduleRefreshBottom();
        }, MIN_INTERVAL_MS - elapsed);
      }
      return;
    }

    lastRun = now;
    setTimeout(runTmuxRefresh, DELAY_AFTER_EVENT_MS);
  }

  // Assistant streaming updates are the main source of incremental output.
  pi.on("message_update", () => {
    scheduleRefreshBottom();
  });

  // Tool execution can also stream partial output into the TUI.
  pi.on("tool_execution_update", () => {
    scheduleRefreshBottom();
  });

  // Final message/tool events often trigger one last render pass.
  pi.on("message_end", () => {
    scheduleRefreshBottom();
  });

  pi.on("tool_execution_end", () => {
    scheduleRefreshBottom();
  });

  // Footer/status information can change when a turn ends.
  pi.on("turn_end", () => {
    scheduleRefreshBottom();
  });

  pi.on("session_shutdown", () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  });
}
