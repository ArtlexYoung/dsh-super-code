# Code workbench

[中文](../CodeWorkbench.md) · English

Enable **Settings → Code workbench** to add **Code workbench** beside Conversation and Trajectory. It is off by default and saved in the current client. Toggling it does not initialize projects or change presets.

Browse the current conversation's working directory on the left. Edits stay in buffers until **Save** or Ctrl/⌘+S. Switching files or leaving the page preserves buffers and undo history; save before closing the application or unloading the plugin. If another program changes a file on disk, saving refuses to overwrite it and keeps your edits.

Common languages have syntax highlighting, keyword and primitive-type suggestions, and project-symbol completion. Hover over functions for source signatures and adjacent documentation. Ctrl/⌘+click a call for definitions, or a definition for usages. Use toolbar navigation or mouse side buttons to move backward and forward. Ctrl/⌘+F searches the current file; Ctrl/⌘+Shift+F searches the project. Tab and Shift+Tab indent and outdent. **Editor settings** offers independent IDEA and VS Code palettes and keymaps, plus custom shortcuts.

Select code, choose **Ask / Edit**, enter a request, and send. The assistant uses the current conversation's selected model. It receives the file buffer, selection, request, and that bubble's history, with no main-conversation history or tools. An edit replaces only the selection and can be undone; saving writes it to disk. Changed selections, interrupted requests, and incomplete model responses are not applied.

An unsent draft creates no marker. Sending or pinning creates a circle beside the selection. Click it to reopen the conversation; the bubble offers pin, unpin, and delete. Deleting cancels an active request. Markers and bubble history remain only for the current plugin lifecycle and are not written into the project.

Navigation returns basic name matches, without full type inference, import-alias resolution, or exact overload analysis. JS/TS, Python, Go, Rust, C/C++, Java, and PHP use syntax trees; C#, Kotlin, Swift, Ruby, and Shell use token highlighting and declaration rules. Types and documentation come from source, without invented types. Text files are limited to 2 MiB each; indexing is limited to 2000 source files, 1000 directories, and a 16 MiB text budget. Dependency and build directories are skipped. A notice identifies partial indexing or read failures.

This module currently provides editing and selection assistance. Git operations, learning workflows, and persistent cross-session bubble history are not integrated yet.
