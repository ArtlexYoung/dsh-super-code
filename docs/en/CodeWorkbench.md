# Code workbench

[中文](../CodeWorkbench.md) · English

Enable **Settings → Code workbench** to add **Code workbench** beside Conversation and Trajectory. It is off by default and saved in the current client. Toggling it does not initialize projects or change presets.

Browse the current conversation's working directory on the left. Edits stay in buffers until **Save** or Ctrl/⌘+S. Switching files or leaving the page preserves buffers and undo history; save before closing the application or unloading the plugin. If another program changes a file on disk, saving refuses to overwrite it and keeps your edits.

Common languages have syntax highlighting, keyword and primitive-type suggestions, and project-symbol completion. Hover over functions for source signatures and adjacent documentation. Ctrl/⌘+click a call for definitions, or a definition for usages. Use toolbar navigation or mouse side buttons to move backward and forward. Ctrl/⌘+F searches the current file; Ctrl/⌘+Shift+F searches the project. Tab and Shift+Tab indent and outdent. **Editor settings** offers independent IDEA and VS Code palettes and keymaps, plus custom shortcuts.

Select code, choose **Ask / Edit**, enter a request, and send. The assistant uses the current conversation's selected model. It receives the file buffer, selection, request, and that bubble's history, with no main-conversation history or tools. An edit replaces only the selection and can be undone; saving writes it to disk. Changed selections, interrupted requests, and incomplete model responses are not applied.

An unsent draft creates no marker. Sending or pinning creates a circle beside the selection. Click it to reopen the conversation; the bubble offers pin, unpin, and delete. Deleting cancels an active request. Markers and bubble history remain only for the current plugin lifecycle and are not written into the project.

Navigation returns basic name matches, without full type inference, import-alias resolution, or exact overload analysis. JS/TS, Python, Go, Rust, C/C++, Java, and PHP use syntax trees; C#, Kotlin, Swift, Ruby, and Shell use token highlighting and declaration rules. Types and documentation come from source, without invented types. Text files are limited to 2 MiB each; indexing is limited to 2000 source files, 1000 directories, and a 16 MiB text budget. Dependency and build directories are skipped. A notice identifies partial indexing or read failures.

Choose **Git** in the toolbar to manage the repository in the current conversation's working directory. Native Git is preferred; the bundled engine is used only when Git is unavailable. The panel identifies the active engine. Opening it does not initialize a repository; initialization requires confirmation. Native Git respects existing hooks and authentication configuration. Failed operations are never replayed through another engine.

**Working copy** separates staged and unstaged files. Select a file for a side-by-side comparison, synchronized scrolling, and previous/next-change navigation, or open it in the editor. Stage or unstage individual files or all listed files. Confirmation shows all staged files before committing. Session and Agent filters use successful file operations in loaded conversations. These links indicate related operations, not line-by-line authorship; arbitrary shell changes are not attributed.

**History** shows the latest 30 commits and their changed files and comparisons. **Branches** supports creating, switching, deleting merged branches, and merging local or fetched remote branches into the current branch. Edit and save conflicts, stage resolutions, then commit the merge, or confirm an abort. Native Git uses its own merge capabilities. The bundled engine supports fast-forward and common three-way merges, with explicit errors for unsupported merges. Handle unsaved edits and uncommitted changes before switching, merging, or pulling.

**Remotes** supports URL configuration, fetch, fast-forward-only pull, and normal push, without force push. The bundled engine supports HTTP(S); native Git also supports SSH. Credentials must not be embedded in URLs. Entered passwords or tokens stay in memory and are cleared when leaving the remote tab or closing the window. Native Git may also use existing credential helpers and SSH configuration. Pull and push confirmation identifies the branch and remote URL.

The session working directory must be the repository root on a locally accessible filesystem. Read-only sessions can inspect state and diffs. In restricted sessions, all native Git commands use the host command sandbox, including reads that may execute repository-configured filters. The bundled engine does not support linked worktrees or `.git` files/symlinks; use native Git for those layouts. At most 2,000 changed files are shown. Text comparisons are limited to 2 MiB per side and 20,000 lines total. Learning workflows and persistent cross-session selection history are not integrated yet.
