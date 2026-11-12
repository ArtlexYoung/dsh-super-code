import { hasRule, must, stateKey, } from "../ir.mjs";
export function pathGraph(names) {
    const graph = { states: new Map(), steps: [] };
    const ids = new Map();
    const taken = new Map();
    const idOf = (vars, start) => {
        if (!vars)
            throw new Error("TLC's trace has a state with no values.");
        const k = stateKey(names.map((name) => vars[name]));
        let id = ids.get(k);
        if (id === undefined) {
            ids.set(k, (id = String(ids.size)));
            graph.states.set(id, { vars, start, breaks: [] });
        }
        else if (start)
            must(graph.states, id).start = true;
        return id;
    };
    const route = (seq) => {
        const start = idOf(seq[0].vars, true);
        const path = [];
        let from = start;
        for (let i = 1; i < seq.length; i++) {
            const { action } = seq[i];
            const to = idOf(seq[i].vars, false);
            const k = `${from} ${to} ${action}`;
            let step = taken.get(k);
            if (!step) {
                taken.set(k, (step = { from, to, action }));
                graph.steps.push(step);
            }
            path.push({ action, state: to, step });
            from = to;
        }
        return { start, path };
    };
    return {
        graph,
        bug: (rule, trace) => {
            if (!trace.length)
                throw new Error(`TLC's trace for ${rule.name} has no states.`);
            const bug = { rule, ...route(trace) };
            const end = must(graph.states, bug.path.at(-1)?.state ?? bug.start);
            if (!hasRule(end.breaks, rule))
                end.breaks.push(rule);
            return bug;
        },
        lasso: ({ seq, loop }) => seq.length ? { ...route(seq), loop, stutters: loop === seq.length - 1 } : undefined,
    };
}
