# Browser feedback without restarting the workflow

## Select evidence and a working method

Identify what the check must prove. Build/type checks detect code-level issues; DOM assertions verify structure and state; a rendered view reveals layout; actual actions reveal behavior. None alone proves all of them. Use the installed, available tools that can produce the needed evidence, following their documented APIs.

Direct browser access, Playwright and Computer Use can all serve the same testing objective. Prefer a known working session and appropriate capability over a fixed order of browsers or tools. Automation is useful for repeatable assertions; Computer Use is useful for real native interaction and visual observation. Do not assume any particular browser bridge, automation package or image tool is installed. Do not add dependencies or change host settings merely to follow a preferred method.

Confirm the app's real startup command, working directory, ready URL and loaded build. An existing server may be suitable; inspect it before starting another. Verify readiness and observable page state, not just that a process or tab exists. Source edits do not prove that an installed or cached build has updated.

## Check geometry and the effort to operate it

For an alignment or ergonomic defect, pick the affected content, state, container size and input method. Verify these relationships through the rendered interface:

- **Alignment:** compare intended shared edges/baselines across repeated rows. Use DOM rectangles and computed styles to locate the cause, then inspect the visible glyphs and spacing. Fractional coordinates at zoom are not automatically defects; judge the intended relationship rather than demanding integer equality everywhere.
- **Clearance:** inspect long/localized labels, text enlarged to 200% when applicable, narrow containers and hover/focus/selected/running/error states. Include outlines, overlays and painted effects in the visual check; `getBoundingClientRect()` alone does not measure all of them. Confirm that essential content and focused controls remain unobscured.
- **Hit area:** measure the actual interactive element and check representative points inside the advertised target, including padding or the far end of an actionable row. Check nearby secondary actions too. A programmatic click or a framework locator click may not establish real pointer geometry; where needed, use coordinate hit testing and an actual pointer/touch action to detect interception. Ensure enlarging one target does not steal another's input.
- **Stability and reach:** walk through the primary task and repeat its frequent action. Watch for control movement during loading, a menu that closes while moving toward it, unnecessary scrolling, or a toolbar that is visually distant from what it changes. Distinguish an observed problem from a guess about user preference. Responsive emulation can check layout, but does not prove real one-handed comfort.
- **Alternative input and recovery:** complete the affected flow with keyboard focus visible and without relying on hover. For touch-supported flows, inspect the supported touch behavior. Verify that cancellation, a failed action and its next step preserve the user's context.

Use the [target-size criterion](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) when assessing Web minimum sizing and exceptions. Numeric checks help locate defects; passing them does not prove the whole interface is usable. Attach geometry assertions to an actual bug or required relationship, not a screenshot's arbitrary pixel coordinates. Verify risky actions with isolated test data or a safe equivalent.

## Preserve confirmed progress

Track stages only when a failure or long task needs them:

`connection → app startup → navigation → target location → action → assertion → evidence capture`

Record the last confirmed stage, the failed stage with its actual error, and the smallest changed input that warrants another attempt. Keep a short continuation note when useful:

```text
Goal: verify filter results and narrow layout
App/build: current dev server; ready URL confirmed
Session: existing browser/tab identifier
Confirmed: page loaded; filter control located
Failure: assertion saw stale results while request was pending
Next: wait for the observable completed state; reuse the same page
Evidence: result/log path and tested viewport
```

Use available task state for this note, without requiring a new persistence tool. It is current progress, not a permanent statement that a browser is unusable.

## Recover at the failing boundary

- Connection unavailable: inspect the actual capability/session or choose another available method. Do not run the same failed connection chain again without a relevant change.
- Startup fails: inspect process output, command, port and dependency state. Changing browser methods will not repair a server that never started.
- Navigation fails: inspect the ready URL, response and authentication state. A working browser connection can be retained.
- Target missing: check route, loading state, frames, accessible name and current DOM before inventing a selector. A cached handle may need reacquisition after remount.
- Action fails: distinguish disabled/pending, intercepted hit area, focus, stale element and product behavior. Do not replay an action with unknown side effects until its outcome is known.
- Assertion fails: verify that the intended state is settled, then diagnose a product defect or a faulty expectation. A failed product check is evidence; switching browsers does not turn it into a pass.
- Capture fails: retain successful actions/assertions and retry capture with a working capability. Missing screenshots do not mean earlier navigation failed.

Repeat only with a changed condition or a justified way to observe progress. If no available method can supply the required evidence, finish independent checks and report the precise gap. Re-probe an earlier method when its environment changes or its capability is needed; a historical failure is not a permanent ban. These are workflow instructions, not an enforced loop detector.

## Give the next edit precise feedback

Record the viewport/container size, route, input/state and expected versus observed result. Use concrete screenshots, DOM values, interaction results and relevant console/network failures. Tie each finding to the tested build. Keep artifacts task-local and avoid credentials or private page content in reports.

Recheck the affected flow after the fix. For visual changes, inspect representative wide/narrow layouts and relevant themes/content; for state changes, cross the affected transition. Reuse successful setup while it remains valid. Distinguish verified behavior, simulated cases and unavailable checks in the final delivery.
