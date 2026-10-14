---
name: super-code-frontend
description: >-
  Build, refine, and verify web interfaces: visual hierarchy, alignment, ergonomic
  controls, responsive layout, interaction states, accessibility, and browser feedback.
  Use for frontend pages,
  components, dashboards, forms, landing pages, or UI bugs; follow the project's
  actual framework and design system.
---

# Frontend work

Deliver a coherent interface that works in its real application. Reuse this skill within the task; read only the references needed for the current decision. Resolve their paths from the resource base returned by the skill tool, not the project's working directory.

## Establish the target

- Identify the page's audience, primary action, input methods and required states from the request. A modification usually keeps the existing visual language; a new design needs a deliberate direction. Read [visual-design.md](references/visual-design.md) when choosing or repairing appearance, alignment and responsive layout.
- Inspect the real route, component imports and props, styling/theme tokens, assets and local commands. Follow callers or installed source for uncertain APIs. Do not invent component properties, replace the stack, or install a UI library merely for convenience.
- Choose the smallest complete slice through the real entry point. Use representative content with long labels, empty values and realistic density. Keep demo data visibly separate from connected behavior; a mock success is not a completed integration.

## Build and inspect

- Make the primary flow work, then refine its hierarchy and spacing using the rendered result. Use the existing theme and components where they fit. Polish should explain the content and actions, not hide a broken flow behind decoration.
- Read [interaction-states.md](references/interaction-states.md) for control reach, input effort, predictable feedback, forms, async requests, navigation, dialogs, expandable panels or state restoration. Carry a state change through defaults, events, rendering and cleanup rather than fixing only the visible symptom.
- Read [browser-validation.md](references/browser-validation.md) for geometry and hit-area checks, browser testing or repeated tool failures. Direct browser access, Playwright and Computer Use are methods for the same testing goal. Reuse the working session and last confirmed stage; choose by available capability and required evidence, without a fixed fallback ladder.
- Treat usability as part of design: related elements share meaningful alignment; text, focus rings and controls have room; the visible action has a reliable hit area; frequent actions avoid needless travel and precision. Apply these principles within the product's own visual language.
- Inspect the relevant wide and narrow layouts, actual user actions, and affected loading/empty/error states. For a localized fix, check the affected boundary instead of replaying every unrelated flow after each edit.

## Close the loop

Tie each defect to an observed state and fix its cause. Recheck the changed behavior and nearby affected contracts. Separate build/test results, DOM assertions, rendered observations and live integration evidence in the delivery. If visual inspection or a backend is unavailable, say exactly what remains unverified; do not describe an unseen page as visually verified.

Retain only the continuation information needed for longer work: target, current app/build and browser session, confirmed progress, failed stage/reason, evidence and next check. Use available task state for this run. Propose reusable environment knowledge or skill improvements only after verifying their scope; this skill does not itself persist memory or implement a retry guard.
