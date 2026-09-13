/**
 * Public entry point for the dependency-free dsh-super-agent domain protocol.
 *
 * The Cordis adapter intentionally lives at `dsh-super-agent/dsh`. Keeping it
 * out of this module means callers can use the task graph and ledgers without
 * installing the optional Harness peer packages.
 */
export * from './core/protocol.js'
export * from './core/task-graph.js'
export * from './core/dispatcher.js'
export * from './core/review.js'
export * from './core/research.js'
export * from './core/optimization.js'
