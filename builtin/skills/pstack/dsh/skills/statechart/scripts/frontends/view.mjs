import { checked, list } from "../ir.mjs";
const projected = new WeakMap();
export const json = (v) => {
    if (typeof v !== "object")
        return v;
    if (v.kind === "model")
        return v.name;
    let j = projected.get(v);
    if (j === undefined) {
        if (v.kind === "interval") {
            const members = [];
            for (let k = v.lo; k <= v.hi; k++)
                members.push(k);
            j = members;
        }
        else if (v.kind === "set") {
            const members = [];
            for (const m of v.members)
                members.push(json(m));
            j = members;
        }
        else {
            const fields = [];
            for (let i = 0; i < v.keys.length; i++) {
                const k = json(v.keys[i]);
                fields.push([typeof k === "object" ? JSON.stringify(k) : String(k), json(v.values[i])]);
            }
            j = Object.fromEntries(fields);
        }
        projected.set(v, j);
    }
    return j;
};
const projectedVars = new WeakMap();
const jsonVars = (vars) => {
    let j = projectedVars.get(vars);
    if (j === undefined) {
        const fields = [];
        for (const [name, v] of Object.entries(vars))
            fields.push([name, json(v)]);
        j = Object.fromEntries(fields);
        projectedVars.set(vars, j);
    }
    return j;
};
const THEME_COLORS = ["blue", "orange", "purple", "yellow", "teal", "tan", "pink"];
const isFunction = (v) => typeof v === "function";
const isPlainObject = (v) => {
    if (typeof v !== "object" || v === null)
        return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
};
const isString = (v) => typeof v === "string";
const VIEW_EXPORTS = ["state", "step", "group", "colors", "title"];
export function checkView(view, inspect) {
    const literal = (v) => typeof v === "string" ? JSON.stringify(v) : inspect(v, { breakLength: Infinity });
    const extra = [];
    for (const name of Object.keys(view))
        if (!VIEW_EXPORTS.includes(name))
            extra.push(name);
    if (extra.length)
        throw new Error(`The view exports ${list(extra)}, which the command does not read. Export only ${list(VIEW_EXPORTS)}.`);
    const wrong = [];
    const pick = (name, kind, fits) => {
        const v = view[name];
        if (v === undefined || fits(v))
            return v;
        wrong.push(`${name} must be ${kind}`);
        return undefined;
    };
    const state = pick("state", "a function", isFunction);
    const step = pick("step", "a function", isFunction);
    const group = pick("group", "a function", isFunction);
    const exported = pick("colors", "a plain object", isPlainObject);
    const title = pick("title", "a string", isString);
    if (wrong.length)
        throw new Error(`The view's ${list(wrong)}.`);
    if (group !== undefined && exported === undefined)
        throw new Error("The view exports group() but no colors. Give each group a color in colors.");
    const colors = Object.create(null);
    const bad = [];
    for (const [name, color] of Object.entries(exported ?? {})) {
        if (typeof color === "string" && THEME_COLORS.includes(color))
            colors[name] = color;
        else
            bad.push(`${JSON.stringify(name)} the color ${literal(color)}`);
    }
    if (bad.length)
        throw new Error(`The view's colors give ${list(bad)}. Give each group ${list(THEME_COLORS, "or")}.`);
    const named = group &&
        ((vars) => {
            const g = group(jsonVars(vars));
            if (g !== undefined && !Object.hasOwn(colors, typeof g === "symbol" ? g : String(g)))
                throw new Error(`The view's group() returned ${literal(g)}, which colors does not name. Give each group a color in colors.`);
            return g;
        });
    return {
        state: state && ((vars) => state(jsonVars(vars))),
        step: step &&
            ((action, from, to) => step(action, jsonVars(from), jsonVars(to))),
        group: named,
        colors,
        title,
        [checked]: true,
    };
}
