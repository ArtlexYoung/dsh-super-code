# Interaction and state continuity

## Reduce physical and mental effort

Start with the task people repeat and the input they actually use. A control should communicate its action, relate visibly to what it affects, and be easy to acquire without careful aiming. Preserve the application's familiar interaction conventions; each invented gesture or inconsistent behavior adds work for the user.

- Place contextual actions near their content and keep frequent actions readily reachable. Reduce needless pointer travel, thumb stretching and repeated scrolling, without crowding controls. Thumb reach varies with device size, grip and handedness; do not assume one universal bottom corner. On a narrow screen, a wider primary control can be useful when it fits the reading and action flow.
- Size the **hit area**, not merely the icon. Around 44 by 44 CSS pixels is a useful comfort starting point for frequent touch actions; it is not a universal Web minimum or a conversion of native platform units. Pointer-oriented dense tools may use smaller controls with sufficient separation. WCAG 2.2 AA target sizing generally requires at least 24 by 24 CSS pixels or a qualifying exception, including its defined spacing alternative. Check the relevant criterion and input context; minimum compliance alone does not establish comfort.
- Use real control padding or a carefully bounded hit region to enlarge targets. Adjacent targets must remain distinct. If a row looks wholly actionable, its intended row area should respond; unrelated trailing actions need separate controls and hit regions, without nesting buttons or links.
- Keep repeated actions in stable positions. Do not let a spinner, validation message or changing count move the control under the pointer. Reserve space where practical, and allow longer translated labels to wrap or reflow without becoming tiny.
- Prefer simple actions for common tasks. Give drag, swipe, hover or precision gestures an appropriate button/keyboard alternative when they are needed for core functionality. Hover-only controls and narrow pointer paths into a submenu need another way to operate them.

Group choices around the user's decision and reveal secondary options when needed. Use meaningful labels for unfamiliar actions rather than unexplained icons. Emphasis can distinguish a preferred action while secondary actions remain usable. Separate destructive actions from frequently repeated safe actions; do not make irreversible deletion the casual default.

## Trace the user's action through the state

List only the states relevant to the flow before editing: initial, pending, success, empty, invalid input and recoverable failure. Decide which are distinct. “No records yet,” “no search matches,” and “could not load” need different explanations and next actions.

For async actions, specify the owner of the request, what can be repeated, when a response becomes stale, and what survives navigation or hiding. UI feedback must correspond to the actual operation: show pending work, prevent unintended duplicates, and show success only after the promised boundary succeeds.

Keep the user's input on failure. Put a useful error near the affected field/action and provide a recovery path. A failed save should not close the editor or overwrite the draft with old server state. Use inline feedback for local validation; a toast alone is usually insufficient to repair a field.

## Keep actions predictable and feedback proportional

For direct manipulation, keep the action connected to its object: selection shows which item will change, dragging gives a visible preview, and cancel or undo follows the product's contract. If optimistic rendering is appropriate, reconcile failure and retain the recoverable data; never silently leave a failed change looking committed.

Give immediate local acknowledgement of input, then distinguish pending work from completion. Put routine status beside the relevant action or content. Use an interrupting dialog for a decision that actually needs attention, not every ordinary success. Animation can explain a transition, but should not delay the next action or replace a persistent state cue.

Keep feedback understandable without relying on color, motion or sound alone. Announce relevant status through accessible semantics without stealing focus for routine updates. A disabled control should have an understandable reason and next step when its unavailability is not obvious. Important errors and recovery actions should remain available long enough to use; an auto-dismiss toast is not their only home.

## Choose one source of truth

Represent mutually exclusive states directly. Two panels that must never both be expanded generally need one `activePanel` value, not two booleans plus corrective effects. Define what clicking the active header does from the requested behavior, rather than assuming an accordion convention.

Separate stored data, editable draft, view/navigation state and transient request state where their lifetimes differ. Derive values instead of keeping redundant copies. Trace a changed state shape through initialization, URL/deep links, persistence, hidden/remounted views and reset behavior. Ensure asynchronous callbacks still address the current owner; replacing a shared state object can detach an editor from its rendered state.

For autocomplete, filters or rapid navigation, cancel superseded requests or reject late results using request identity. Release listeners, timers, observers and subscriptions with their owner. A hidden panel and an unmounted panel have different lifetimes; neither automatically means the user intended to abandon a pending save.

## Semantics and focus are functional behavior

- Use native buttons, links, labels and input controls. Keep navigation as links and actions as buttons; set button types deliberately inside forms.
- Keyboard operation must reach the primary flow, visible focus and recovery actions. Do not make hover the only way to discover or operate a control. For disclosures, expose expanded state and the controlled region.
- A dialog needs an accessible name, intentional initial focus, contained keyboard navigation and focus restoration on close. A popover, menu and modal are different patterns; use an existing accessible implementation when available.
- When hiding content, move focus if its current target disappears. Avoid intercepting an unrelated action inside a clickable header; verify the real nested hit areas.
- For destructive actions, follow the product's confirmation or undo pattern. Prevent duplicate submissions; retain the context needed to recover from a failed operation.

## Verify transitions, not just snapshots

A useful check crosses a boundary: empty to loaded, edit to cancel, failure to retry, hidden to restored, pending to completion, old response to rejected stale result. Select transitions affected by the diff and exercise them through the real route/component.

Use unit/component tests for deterministic state rules and browser checks for navigation, focus, geometry and real interaction. Force failures through an existing test seam or isolated fixture, not by corrupting the user's data. Separate simulated error handling from a live backend check. Add regressions for actual bugs; do not add tests that merely assert the implementation's strings.
