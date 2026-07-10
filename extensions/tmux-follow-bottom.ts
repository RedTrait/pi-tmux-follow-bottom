import { execFile } from "node:child_process";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, type EditorComponent } from "@earendil-works/pi-tui";

/**
 * Minimum time between tmux refresh calls.
 *
 * Assistant token streaming can emit many updates per second. Refreshing tmux
 * on every token is unnecessary, so this value coalesces bursts of events.
 */
const MIN_INTERVAL_MS = Number(process.env.PI_TMUX_FOLLOW_MIN_INTERVAL_MS ?? 120);

/**
 * Delay before refreshing tmux after a pi output event.
 *
 * pi schedules TUI rendering asynchronously. A short delay gives pi time to
 * render the update before tmux is asked to move the client viewport back to
 * the bottom.
 */
const DELAY_AFTER_EVENT_MS = Number(process.env.PI_TMUX_FOLLOW_DELAY_MS ?? 25);

/**
 * Delay before refreshing tmux after editor input that can open or move the
 * slash-command popup. Popup rendering is editor-driven, not message-driven.
 */
const DELAY_AFTER_EDITOR_MS = Number(process.env.PI_TMUX_FOLLOW_EDITOR_DELAY_MS ?? 35);

/**
 * How long to keep following editor navigation after '/' is typed.
 */
const SLASH_POPUP_WINDOW_MS = Number(process.env.PI_TMUX_FOLLOW_SLASH_POPUP_WINDOW_MS ?? 15_000);

const FOLLOW_EDITOR_KEYS = process.env.PI_TMUX_FOLLOW_EDITOR_KEYS !== "0";

class FollowBottomEditor implements EditorComponent {
  constructor(
    private readonly base: EditorComponent,
    private readonly afterInput: (data: string) => void,
  ) {}

  get wantsKeyRelease(): boolean | undefined {
    return this.base.wantsKeyRelease;
  }

  get onSubmit(): ((text: string) => void) | undefined {
    return this.base.onSubmit;
  }

  set onSubmit(value: ((text: string) => void) | undefined) {
    this.base.onSubmit = value;
  }

  get onChange(): ((text: string) => void) | undefined {
    return this.base.onChange;
  }

  set onChange(value: ((text: string) => void) | undefined) {
    this.base.onChange = value;
  }

  get borderColor(): ((str: string) => string) | undefined {
    return this.base.borderColor;
  }

  set borderColor(value: ((str: string) => string) | undefined) {
    this.base.borderColor = value;
  }

  render(width: number): string[] {
    return this.base.render(width);
  }

  getText(): string {
    return this.base.getText();
  }

  setText(text: string): void {
    this.base.setText(text);
  }

  handleInput(data: string): void {
    this.base.handleInput(data);
    this.afterInput(data);
  }

  addToHistory(text: string): void {
    this.base.addToHistory?.(text);
  }

  insertTextAtCursor(text: string): void {
    this.base.insertTextAtCursor?.(text);
  }

  getExpandedText(): string {
    return this.base.getExpandedText?.() ?? this.base.getText();
  }

  setAutocompleteProvider(provider: Parameters<NonNullable<EditorComponent["setAutocompleteProvider"]>>[0]): void {
    this.base.setAutocompleteProvider?.(provider);
  }

  setPaddingX(padding: number): void {
    this.base.setPaddingX?.(padding);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.base.setAutocompleteMaxVisible?.(maxVisible);
  }

  invalidate(): void {
    this.base.invalidate();
  }
}

export default function (pi: ExtensionAPI) {
  let lastRun = 0;
  let refreshTimer: NodeJS.Timeout | undefined;
  let slashPopupUntil = 0;
  let previousEditorFactory: ReturnType<ExtensionContext["ui"]["getEditorComponent"]>;
  let editorFollowerInstalled = false;

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

  function scheduleRefreshBottom(renderDelayMs = DELAY_AFTER_EVENT_MS): void {
    if (!isInsideTmux()) return;
    if (refreshTimer) return;

    const now = Date.now();
    const throttleDelay = Math.max(0, MIN_INTERVAL_MS - (now - lastRun));

    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      lastRun = Date.now();
      runTmuxRefresh();
    }, throttleDelay + renderDelayMs);
  }

  function isPopupNavigationKey(data: string): boolean {
    return (
      matchesKey(data, "up") ||
      matchesKey(data, "down") ||
      matchesKey(data, "pageUp") ||
      matchesKey(data, "pageDown") ||
      matchesKey(data, "home") ||
      matchesKey(data, "end") ||
      matchesKey(data, "tab") ||
      matchesKey(data, "backspace") ||
      matchesKey(data, "delete")
    );
  }

  function isPrintableKey(data: string): boolean {
    return data.length === 1 && data >= " " && data !== "\x7f";
  }

  function handleEditorInput(data: string): void {
    if (data === "/") {
      slashPopupUntil = Date.now() + SLASH_POPUP_WINDOW_MS;
      scheduleRefreshBottom(DELAY_AFTER_EDITOR_MS);
      return;
    }

    if (matchesKey(data, "escape") || matchesKey(data, "enter")) {
      slashPopupUntil = 0;
      return;
    }

    if (Date.now() > slashPopupUntil) return;

    if (isPrintableKey(data) || isPopupNavigationKey(data)) {
      slashPopupUntil = Date.now() + SLASH_POPUP_WINDOW_MS;
      scheduleRefreshBottom(DELAY_AFTER_EDITOR_MS);
    }
  }

  function installEditorFollower(ctx: ExtensionContext): void {
    if (!FOLLOW_EDITOR_KEYS || ctx.mode !== "tui" || editorFollowerInstalled) return;

    previousEditorFactory = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const base = previousEditorFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
      return new FollowBottomEditor(base, handleEditorInput);
    });
    editorFollowerInstalled = true;
  }

  pi.on("session_start", (_event, ctx) => {
    installEditorFollower(ctx);
  });

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

  pi.on("session_shutdown", (_event, ctx) => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }

    if (editorFollowerInstalled && ctx.mode === "tui") {
      ctx.ui.setEditorComponent(previousEditorFactory);
      editorFollowerInstalled = false;
    }
  });
}
