import { byText, count, defaultState, must, ruleKey, sortBy, } from "../ir.mjs";
export function walk(graph) {
    const ids = [];
    const states = [];
    const nameOf = [];
    const starts = [];
    const unique = new Set();
    for (const [id, s] of graph.states) {
        const name = defaultState(s.vars);
        if (s.start)
            starts.push(ids.length);
        ids.push(id);
        states.push(s);
        nameOf.push(name);
        unique.add(name);
    }
    const names = Array.from(unique).sort(byText);
    const rankOf = new Map();
    for (let i = 0; i < names.length; i++)
        rankOf.set(names[i], i);
    const n = ids.length;
    const index = new Map();
    const nameRank = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        index.set(ids[i], i);
        nameRank[i] = must(rankOf, nameOf[i]);
    }
    const m = graph.steps.length;
    const from = new Int32Array(m);
    const to = new Int32Array(m);
    const action = new Int32Array(m);
    const actions = new Map();
    for (let j = 0; j < m; j++) {
        const t = graph.steps[j];
        from[j] = must(index, t.from);
        to[j] = must(index, t.to);
        let a = actions.get(t.action);
        if (a === undefined)
            actions.set(t.action, (a = actions.size));
        action[j] = a;
    }
    const actionRank = new Int32Array(actions.size);
    for (const [i, a] of [...actions.keys()].sort(byText).entries())
        actionRank[must(actions, a)] = i;
    const toName = new Int32Array(m);
    for (let j = 0; j < m; j++) {
        action[j] = actionRank[action[j]];
        toName[j] = nameRank[to[j]];
    }
    const first = new Int32Array(n + 1);
    for (let j = 0; j < m; j++)
        first[from[j] + 1]++;
    for (let i = 0; i < n; i++)
        first[i + 1] += first[i];
    const fill = first.slice(0, n);
    const next = new Int32Array(m);
    for (const j of sortBy(count(m), [action, toName]))
        next[fill[from[j]]++] = j;
    starts.sort((a, b) => nameRank[a] - nameRank[b]);
    const depth = new Int32Array(n).fill(-1);
    const via = new Int32Array(n).fill(-1);
    const reached = new Int32Array(n);
    let size = 0;
    for (const s of starts) {
        depth[s] = 0;
        reached[size++] = s;
    }
    for (let q = 0; q < size; q++) {
        const s = reached[q];
        for (let e = first[s]; e < first[s + 1]; e++) {
            const t = to[next[e]];
            if (depth[t] >= 0)
                continue;
            depth[t] = depth[s] + 1;
            via[t] = next[e];
            reached[size++] = t;
        }
    }
    return {
        ids,
        states,
        index,
        nameOf,
        nameRank,
        from,
        to,
        action,
        depth,
        via,
        reached: reached.subarray(0, size),
        starts,
    };
}
export function drawOrder({ depth, nameRank }) {
    const n = depth.length;
    let deepest = 0;
    for (let i = 0; i < n; i++)
        if (depth[i] > deepest)
            deepest = depth[i];
    const level = new Int32Array(n);
    for (let i = 0; i < n; i++)
        level[i] = depth[i] < 0 ? deepest + 1 : depth[i];
    const order = sortBy(count(n), [level, nameRank]);
    const rank = new Int32Array(n);
    for (let p = 0; p < n; p++)
        rank[order[p]] = p;
    return { order, rank };
}
export function bugs(graph, { ids, from, via, reached } = walk(graph)) {
    const ends = new Map();
    for (const [id, s] of graph.states)
        for (const rule of s.ends ?? [])
            ends.set(ruleKey(rule), id);
    const first = new Map();
    for (const i of reached) {
        const s = must(graph.states, ids[i]);
        for (const rule of s.past ? s.ends : s.breaks) {
            const k = ruleKey(rule);
            if (!first.has(k) && (ends.get(k) ?? ids[i]) === ids[i])
                first.set(k, { rule, i });
        }
    }
    const found = [];
    for (const { rule, i } of first.values()) {
        const path = [];
        let start = i;
        for (let j; (j = via[start]) >= 0; start = from[j]) {
            const step = graph.steps[j];
            path.unshift({ action: step.action, state: step.to, step });
        }
        found.push({ rule, start: ids[start], path });
    }
    return found;
}
