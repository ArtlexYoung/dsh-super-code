import { EC } from "../ir.mjs";
import { textOf } from "./messages.mjs";
const NAMED = new Map([
    [EC.TLC_INVARIANT_VIOLATED_INITIAL, ["invariant", /^Invariant (.+) is violated by the initial/]],
    [EC.TLC_INVARIANT_VIOLATED_BEHAVIOR, ["invariant", /^Invariant (.+) is violated\.$/m]],
    [EC.TLC_PROPERTY_VIOLATED_INITIAL, ["property", /^Property (.+) is violated by the initial/]],
    [EC.TLC_ACTION_PROPERTY_VIOLATED_BEHAVIOR, ["property", /^Action property (.+) is violated\.$/m]],
]);
const DISTINCT = new Map([
    [EC.TLC_INIT_GENERATED1, /(\d+) distinct states? generated/],
    [EC.TLC_INIT_GENERATED2, /with (\d+) of them distinct/],
    [EC.TLC_STATS, /(\d+) distinct states found/],
]);
export function readVerdict(messages) {
    let broke;
    let distinct = 0;
    let initial = 0;
    for (const m of messages) {
        if (typeof m === "string")
            continue;
        const count = DISTINCT.get(m.code)?.exec(textOf(m));
        if (count)
            distinct = Math.max(distinct, Number(count[1]));
        if (m.code === EC.TLC_INIT_GENERATED1 || m.code === EC.TLC_INIT_GENERATED2)
            initial = Number(/(\d+) (?:distinct )?states? generated/.exec(textOf(m))?.[1] ?? 0);
        if (broke)
            continue;
        if (m.code === EC.TLC_DEADLOCK_REACHED)
            broke = { kind: "deadlock" };
        else if (m.code === EC.TLC_TEMPORAL_PROPERTY_VIOLATED)
            broke = { kind: "temporal" };
        const named = NAMED.get(m.code);
        const name = named?.[1].exec(textOf(m))?.[1];
        if (named && name)
            broke = { kind: named[0], name };
    }
    return { broke, distinct, initial };
}
