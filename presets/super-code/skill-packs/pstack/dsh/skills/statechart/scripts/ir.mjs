export const EC = {
    TLC_INVARIANT_VIOLATED_INITIAL: 2107,
    TLC_PROPERTY_VIOLATED_INITIAL: 2108,
    TLC_INVARIANT_VIOLATED_BEHAVIOR: 2110,
    TLC_ACTION_PROPERTY_VIOLATED_BEHAVIOR: 2112,
    TLC_DEADLOCK_REACHED: 2114,
    TLC_TEMPORAL_PROPERTY_VIOLATED: 2116,
    TLC_BACK_TO_STATE: 2122,
    TLC_FINISHED: 2186,
    TLC_INIT_GENERATED1: 2190,
    TLC_INIT_GENERATED2: 2191,
    TLC_STATS: 2199,
    TLC_PROGRESS_STATS: 2200,
    TLC_STATE_PRINT2: 2217,
    TLC_STATE_PRINT3: 2218,
    TLC_SANY_END: 2219,
    TLC_SANY_START: 2220,
};
export const LEVEL = { NONE: 0, ERROR: 1, TLCBUG: 2, WARNING: 3, STATE: 4 };
export const RERUN_STATES = 100_000;
export const CHART_STATES = 500;
export const checked = Symbol("checked");
export const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
export const isStrings = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");
export const PART = 1 << 24;
export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const list = (items, and = "and") => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;
const ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\n": "\\n",
    "\t": "\\t",
    "\r": "\\r",
    "\f": "\\f",
};
const quote = (s) => `"${s.replace(/["\\\n\t\r\f]/g, (c) => ESCAPES[c])}"`;
const joined = (items, sep) => {
    let s = "";
    for (let i = 0; i < items.length; i++)
        s += (i ? sep : "") + show(items[i]);
    return s;
};
export const show = (v) => {
    switch (typeof v) {
        case "boolean":
            return v ? "TRUE" : "FALSE";
        case "number":
            return String(v);
        case "string":
            return quote(v);
    }
    switch (v.kind) {
        case "model":
            return v.name;
        case "interval":
            return `${v.lo}..${v.hi}`;
        case "set":
            return `{${joined(v.members, ", ")}}`;
        case "function": {
            if (v.printedAs === "tuple")
                return `<<${joined(v.values, ", ")}>>`;
            const record = v.printedAs === "record";
            let s = record ? "[" : "(";
            for (let i = 0; i < v.keys.length; i++)
                s += record
                    ? `${i ? ", " : ""}${String(v.keys[i])} |-> ${show(v.values[i])}`
                    : `${i ? " @@ " : ""}${show(v.keys[i])} :> ${show(v.values[i])}`;
            return s + (record ? "]" : ")");
        }
    }
};
export const must = (map, key) => {
    const value = map.get(key);
    if (value === undefined)
        throw new Error(`The chart lost track of ${JSON.stringify(key)}.`);
    return value;
};
export const append = (groups, key, item) => {
    const group = groups.get(key);
    if (group)
        group.push(item);
    else
        groups.set(key, [item]);
};
export const seqOf = (bug, index) => {
    const seq = [must(index, bug.start)];
    for (const p of bug.path)
        seq.push(must(index, p.state));
    return seq;
};
export const loopOf = (bug, index) => new Set(bug.loop === undefined ? [] : seqOf(bug, index).slice(bug.loop));
export const defaultState = (vars) => {
    const entries = Object.entries(vars);
    if (entries.length === 1)
        return show(entries[0][1]);
    const parts = [];
    for (const [k, v] of entries)
        parts.push(`${k}=${show(v)}`);
    return parts.join(" ");
};
export const stateText = (vars) => {
    const parts = [];
    for (const [k, v] of Object.entries(vars))
        parts.push(`${k} = ${show(v)}`);
    return parts.join(" /\\ ");
};
export const count = (n) => {
    const items = new Int32Array(n);
    for (let i = 0; i < n; i++)
        items[i] = i;
    return items;
};
export const sortBy = (items, keys) => {
    for (let k = keys.length - 1; k >= 0; k--) {
        const key = keys[k];
        let size = 0;
        for (let p = 0; p < items.length; p++)
            if (key[items[p]] >= size)
                size = key[items[p]] + 1;
        const start = new Int32Array(size + 1);
        for (let p = 0; p < items.length; p++)
            start[key[items[p]] + 1]++;
        for (let v = 0; v < size; v++)
            start[v + 1] += start[v];
        const sorted = new Int32Array(items.length);
        for (let p = 0; p < items.length; p++)
            sorted[start[key[items[p]]]++] = items[p];
        items = sorted;
    }
    return items;
};
export const tupleKey = (parts) => JSON.stringify(parts);
export const unkey = (k) => {
    const parts = JSON.parse(k);
    if (!isStrings(parts))
        throw new Error(`The chart cannot read the key ${k}.`);
    return parts;
};
export function holds(condition, others) {
    switch (condition.kind) {
        case "and":
            for (let j = 0; j < others.length; j++)
                if (!condition.otherKeys[j].has(others[j]))
                    return false;
            return true;
        case "or":
            for (let j = 0; j < others.length; j++)
                if (condition.otherKeys[j].has(others[j]))
                    return true;
            return false;
        case "tuples":
            return condition.otherTuples.has(tupleKey(others));
    }
}
export const ruleKey = (rule) => tupleKey([rule.kind, rule.name]);
export const hasRule = (rules, rule) => {
    for (const r of rules)
        if (r.kind === rule.kind && r.name === rule.name)
            return true;
    return false;
};
const ascending = (keys) => {
    for (let i = 1; i < keys.length; i++)
        if (keys[i - 1] > keys[i])
            return false;
    return true;
};
const span = (lo, hi) => (hi > lo ? `${lo}..${hi}` : String(lo));
const setKey = (members) => {
    const ints = [];
    let others = [];
    for (const m of members)
        if (typeof m === "number")
            ints.push(m);
        else
            others.push(key(m));
    for (let i = 1; i < ints.length; i++)
        if (ints[i - 1] >= ints[i]) {
            ints.sort((a, b) => a - b);
            break;
        }
    if (!ascending(others))
        others = others.sort(byText);
    let s = "{";
    for (let i = 0; i < ints.length;) {
        let j = i;
        while (j + 1 < ints.length && ints[j + 1] - ints[j] <= 1)
            j++;
        s += `${s.length > 1 ? "," : ""}${span(ints[i], ints[j])}`;
        i = j + 1;
    }
    for (let i = 0; i < others.length; i++)
        if (!i || others[i] !== others[i - 1])
            s += (s.length > 1 ? "," : "") + others[i];
    return s + "}";
};
const functionKey = ({ keys, values }) => {
    const order = [];
    const keyTexts = [];
    let ints = 0;
    for (let i = 0; i < keys.length; i++) {
        order.push(i);
        keyTexts.push(key(keys[i]));
        if (typeof keys[i] === "number")
            ints++;
    }
    const rank = (i) => (typeof keys[i] === "number" ? keys[i] : Infinity);
    order.sort((a, b) => rank(a) - rank(b) || byText(keyTexts[a], keyTexts[b]) || a - b);
    let tuple = ints === keys.length;
    for (let i = 0; tuple && i < order.length; i++)
        tuple = keys[order[i]] === i + 1;
    let s = tuple ? "<<" : "(";
    for (let i = 0, kept = 0; i < order.length; i++) {
        const k = order[i];
        if (i && keyTexts[k] === keyTexts[order[i - 1]])
            continue;
        const v = key(values[k]);
        s += tuple ? `${kept++ ? "," : ""}${v}` : `${kept++ ? "@@" : ""}${keyTexts[k]}:>${v}`;
    }
    return s + (tuple ? ">>" : ")");
};
const keys = new WeakMap();
export const key = (v) => {
    switch (typeof v) {
        case "boolean":
            return v ? "TRUE" : "FALSE";
        case "number":
            return String(v);
        case "string":
            return JSON.stringify(v);
    }
    if (v.kind === "model")
        return v.name;
    let k = keys.get(v);
    if (k === undefined) {
        k =
            v.kind === "interval"
                ? `{${v.lo > v.hi ? "" : span(v.lo, v.hi)}}`
                : v.kind === "set"
                    ? setKey(v.members)
                    : functionKey(v);
        keys.set(v, k);
    }
    return k;
};
export const stateKey = (values) => {
    let k = "";
    for (let i = 0; i < values.length; i++)
        k += (i ? "," : "") + key(values[i]);
    return k;
};
export const memo = (make, limit = 1 << 16) => {
    const cache = new Map();
    return (k) => {
        let v = cache.get(k);
        if (v === undefined) {
            if (cache.size >= limit)
                cache.clear();
            cache.set(k, (v = make(k)));
        }
        return v;
    };
};
export const valuesOf = (vars, names) => {
    const values = [];
    for (const n of names)
        values.push(vars[n]);
    return values;
};
export const findTrace = (counterexample, names, rule, find) => {
    const trace = [];
    for (const { action, vars } of counterexample) {
        const values = valuesOf(vars, names);
        trace.push({ action, vars, values, id: find(values) });
    }
    const end = trace.length - 1;
    if (end < 0)
        throw new Error(`TLC's trace for ${rule.name} has no states.`);
    for (let i = 0; i < end; i++)
        if (trace[i].id === undefined)
            throw new Error(`TLC's trace for ${rule.name} has a state before its last that the dump does not list.`);
    return trace;
};
export const findLoop = ({ seq, loop }, names, find) => {
    const found = [];
    for (const { action, vars } of seq)
        found.push({ action, id: vars && find(valuesOf(vars, names)) });
    return { seq: found, loop };
};
export const pastState = (vars, start, marked, excluded) => {
    const breaks = [];
    for (const r of marked)
        if (!hasRule(breaks, r))
            breaks.push(r);
    return { vars, start, breaks, ends: [], past: true, excluded };
};
export const CHECK_DEADLOCK = "CHECK_DEADLOCK";
const deadlockRule = ({ invariants, properties }) => ({
    kind: "deadlock",
    name: invariants.includes("NoDeadlock") || properties.includes("NoDeadlock")
        ? CHECK_DEADLOCK
        : "NoDeadlock",
});
export const hasSection = ({ written }, ...keys) => {
    for (const s of written)
        if (keys.includes(s.key))
            return true;
    return false;
};
export const stateRules = (spec) => {
    const rules = [];
    for (const name of spec.invariants)
        rules.push({ kind: "invariant", name });
    if (spec.deadlock)
        rules.push(deadlockRule(spec));
    return rules;
};
