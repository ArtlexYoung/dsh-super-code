import { append, holds, loopOf, must, tupleKey, unkey, } from "../ir.mjs";
export function loopCheck({ regions, loops }, { names, keys, drawnLabels, sorted }, { index, from, to }, found) {
    const R = names.length;
    const combo = (i) => {
        const parts = [];
        for (let r = 0; r < R; r++)
            parts.push(keys[r][i]);
        return tupleKey(parts);
    };
    const stepsFrom = new Map();
    const arrowsFrom = [];
    if (loops.length) {
        for (const j of sorted)
            append(stepsFrom, from[j], j);
        for (const { arrows } of regions) {
            const out = new Map();
            for (const a of arrows)
                append(out, a.from, a);
            arrowsFrom.push(out);
        }
    }
    for (const b of found) {
        if (b.loop === undefined)
            continue;
        const inLoop = new Set();
        const twinsOf = new Map();
        for (const i of loopOf(b, index)) {
            inLoop.add(combo(i));
            append(twinsOf, combo(i), i);
        }
        for (const i of loopOf(b, index)) {
            const twins = must(twinsOf, combo(i));
            for (const [r, name] of names.entries()) {
                const takes = (a) => {
                    for (const s of twins)
                        for (const j of stepsFrom.get(s) ?? [])
                            if (drawnLabels[j] === a.label && keys[r][to[j]] === a.to)
                                return true;
                    return false;
                };
                const rest = [];
                for (let o = 0; o < R; o++)
                    if (o !== r)
                        rest.push(keys[o][i]);
                for (const a of arrowsFrom[r].get(keys[r][i]) ?? []) {
                    if (!holds(a.condition, rest))
                        continue;
                    const next = [];
                    for (let o = 0; o < R; o++)
                        next.push(o === r ? a.to : keys[o][i]);
                    if (!inLoop.has(tupleKey(next)) && !takes(a))
                        throw new Error(`The chart draws the step ${a.label} out of ${name ? `${name} ` : ""}${unkey(a.from).join(" / ")}, but the ${b.rule.name} loop cannot take it there. Show in a label what stops it.`);
                }
            }
        }
    }
}
