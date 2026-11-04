// Claude Code's default keybindings in the contexts astrocode reads (Global, Chat and Task), as
// Claude Code 2.1.318 for Linux has them: copied from the table in its binary
// (~/.local/share/claude/versions/2.1.318), found with `strings` next to `chat:cycleMode`. They
// agree with https://code.claude.com/docs/en/keybindings and /docs/en/interactive-mode, read on
// 2026-11-03, with three notes:
//
// - Shift+↑ and Shift+↓ (chat:increaseEffort, chat:decreaseEffort) are in 2.1.318's table but not
//   on the docs page, nor in 2.1.301's table (the Agent SDK's bundled binary); 2.1.318 acts on them
//   only behind a feature flag, `tengu_velvety_kay`.
// - chat:imagePaste is Alt+V on Windows and WSL, and chat:cycleMode Meta+M on Windows without VT
//   mode; these are the Linux keys.
// - Ctrl+L keeps the name chat:clearInput, but it redraws the screen and keeps what's typed.
export const CLAUDE_CODE_DEFAULTS: Record<"Global" | "Chat" | "Task", Record<string, string>> = {
  Global: {
    "ctrl+c": "app:interrupt",
    "ctrl+d": "app:exit",
    "ctrl+t": "app:toggleTodos",
    "ctrl+o": "app:toggleTranscript",
    "ctrl+shift+b": "app:toggleBrief",
    "ctrl+r": "history:search",
    "ctrl+up": "app:diffFileListUp",
    "ctrl+down": "app:diffFileListDown",
    "meta+up": "app:diffFileListUp",
    "meta+down": "app:diffFileListDown",
    "ctrl+]": "app:openArtifact",
  },
  Chat: {
    escape: "chat:cancel",
    "ctrl+l": "chat:clearInput",
    "cmd+k": "chat:clearScreen",
    "ctrl+x ctrl+k": "chat:killAgents",
    "shift+tab": "chat:cycleMode",
    "meta+p": "chat:modelPicker",
    "shift+up": "chat:increaseEffort",
    "shift+down": "chat:decreaseEffort",
    "meta+o": "chat:fastMode",
    "ctrl+y": "chat:defaultToNewerModel",
    "meta+t": "chat:thinkingToggle",
    "meta+w": "chat:workflowKeywordToggle",
    enter: "chat:submit",
    "ctrl+x enter": "chat:queueSubmit",
    "ctrl+x ctrl+s": "chat:sendNow",
    "ctrl+enter": "chat:sendNow",
    "ctrl+j": "chat:newline",
    up: "history:previous",
    down: "history:next",
    "ctrl+_": "chat:undo",
    "ctrl+-": "chat:undo",
    "ctrl+shift+-": "chat:undo",
    "ctrl+shift+_": "chat:undo",
    "ctrl+x ctrl+e": "chat:externalEditor",
    "ctrl+x ctrl+a": "abovePrompt:toggle",
    "ctrl+x tab": "abovePrompt:focus",
    "ctrl+g": "chat:externalEditor",
    "ctrl+s": "chat:stash",
    "ctrl+v": "chat:imagePaste",
    space: "voice:pushToTalk",
  },
  Task: {
    "ctrl+x ctrl+b": "task:background",
    "ctrl+b": "task:background",
  },
};
