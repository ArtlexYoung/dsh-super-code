# Visual direction and layout

## Make the composition explain the product

First identify what the visitor should notice, understand and do. A landing page may need one strong proposition and credible proof; an operational dashboard needs comparison, status and fast scanning. Choose hierarchy for that purpose before choosing decoration.

For a new interface, state a compact direction: audience, tone, dominant layout, type hierarchy, palette and one distinctive visual idea. Express it in the implementation, not a long design essay. For an existing interface, derive these from adjacent screens, tokens and assets. A request to fix a panel is not a reason to redesign the whole product.

Use specific, plausible copy and content. Match number formats, units, labels and empty values to the domain. Fake controls, repeated filler cards and decorative charts without interpretable axes make a page look finished while leaving it unusable. If data is a demonstration, label it and still support the intended interaction.

## Hierarchy before effects

- Give the primary action a clear place and distinguish secondary actions by emphasis. Several equally loud buttons weaken the decision.
- Use size, weight, position and whitespace to form a reading order. Do not turn every content group into an elevated card: shared alignment, separators or a plain list often communicates structure more clearly.
- Keep a small, consistent type and spacing system. Use the project's fonts; add fonts only when justified and authorized. Body text needs a comfortable measure and line height, while dense tools may need compact rows. Test actual long titles rather than tuning only a short placeholder.
- Color should carry a purpose: action, status, grouping or atmosphere. Check text and controls against their actual backgrounds in each supported theme. For WCAG AA, ordinary text needs 4.5:1 contrast, large text 3:1; essential UI boundaries and indicators generally need 3:1. Do not use color alone to convey failure or selection.
- Treat imagery, icons and motion as part of the content. Use supplied or available assets and the established icon system. Avoid broken image URLs, misleading placeholder pictures and arbitrary emoji as product icons. Purposeful transitions should show change; respect reduced motion and retain visible state feedback.

When matching a reference, compare proportions, alignment, content density, typography and visual weight before chasing a pixel offset. Preserve the reference's intent while adapting to real content and viewport limits. Do not declare visual equivalence based on matching CSS values alone.

## Align relationships, not isolated pixels

Alignment tells people which items belong together. Establish the relevant shared anchors: a content leading edge, text baseline, column boundary or repeated action position. Indentation should convey actual hierarchy. Labels, values and controls that play the same role should follow the same alignment rule; unrelated elements need not all be centered.

- Put repeated rows on a common grid or layout primitive. Use shared gaps and padding instead of independent margins, spaces in text, or per-item translations. If the same role needs repeated offset patches, inspect its parent layout and component variants.
- Align mixed-size text by baseline where it forms a reading row. An icon's box center may differ from its visible center; correct a demonstrated optical imbalance locally, while preserving its hit area and the surrounding layout rules.
- Distinguish three boundaries: the box participating in layout, everything visibly painted, and the region that receives input. Focus outlines, shadows, selection rings, animation and expanded controls can exceed the layout box. Leave room for their meaningful states without clipping feedback or moving labels with every state change.
- Let content and text sizing determine row height where wrapping is legitimate. A fixed height plus longer copy, a different font or larger text often creates the apparent alignment bug. Fix the sizing constraint before shrinking type or hiding information.
- In diagrams, connectors, labels and nodes need coordinated geometry. Changing the node size without updating link anchors or label clearance creates collisions; test selected and running states as well as the resting geometry.

For a reported offset, compare the relevant edges/baselines and computed parent layout in the actual state. Determine whether the cause is padding, line height, flex shrink, grid sizing, overflow, a transform, font loading or an overlay. Use a shared rule to fix a shared relationship; use a small optical correction only when the visible shape warrants it. Intentional asymmetry is valid when it clarifies hierarchy.

## Responsive behavior is content behavior

Choose breakpoints where the content stops fitting. Let primary content lead when columns collapse, keep important actions reachable, and use intrinsic layout before accumulating fixed widths. A desktop screen squeezed smaller is not a mobile layout.

Inspect the actual containing surface: a sidebar, embedded pane or dialog may be narrow inside a large viewport. Flex/grid children often need `min-width: 0` or `minmax(0, 1fr)` to let text wrap. Fix the element causing overflow instead of masking the whole page with `overflow-x: hidden`.

Use explicit overflow behavior for dense tables or code; retain headers/context and an obvious scrolling region. Sticky bars must not cover focus targets or the final content row. Account for safe-area insets on edge-to-edge surfaces and the on-screen keyboard when they affect the supported device. Check zoom, longer localized strings, touch targets and theme changes when relevant to the requested surface.

## Refine from an observation

Describe a concrete defect: “the action is below the fold at this width,” “this label overlaps the selection ring,” or “the empty state reads like an error.” Trace it to layout, state or styling. Change that cause, then inspect the same content/state/viewport again. Wait for fonts, assets and transitions to settle before evaluating a screenshot; a transition frame is not the final palette.
