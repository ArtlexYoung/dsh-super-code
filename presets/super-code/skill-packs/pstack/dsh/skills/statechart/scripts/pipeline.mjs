import { mermaidLines } from "./backends/mermaid.mjs";
import { plainText } from "./backends/plain-text.mjs";
import { report } from "./backends/report.mjs";
import { PART, ruleKey, } from "./ir.mjs";
import { asParents, ask, labelGraph, storiesOf } from "./passes/label.mjs";
import { lift } from "./passes/lift.mjs";
import { loopCheck } from "./passes/loop-check.mjs";
import { bugs, drawOrder, walk } from "./passes/reach.mjs";
import { regionsLie } from "./passes/region-check.mjs";
import { drawRegions } from "./passes/regions.mjs";
function* inParts(lines) {
    let start = 0;
    let size = 0;
    for (let i = 0; i < lines.length; i++) {
        size += lines[i].length + 1;
        if (size > PART || i === lines.length - 1) {
            yield (start ? "\n" : "") + lines.slice(start, i + 1).join("\n");
            start = i + 1;
            size = 0;
        }
    }
}
const shortestFirst = (a, b) => a.path.length - b.path.length;
export function project(graph, walked, view, found) {
    const { order, rank } = drawOrder(walked);
    const draw = (answers) => {
        const labels = labelGraph(graph, walked, answers, rank, found);
        return { labels, chart: drawRegions(walked, labels, order, found, view) };
    };
    const answers = ask(graph, walked, view);
    const first = draw(answers);
    const lie = regionsLie(first.chart.regions, first.labels, walked, order);
    const { labels, chart } = lie ? draw(asParents(walked, answers)) : first;
    loopCheck(chart, labels, walked, found);
    return {
        chart: lift(lie ? { ...chart, lie } : chart),
        stories: storiesOf(graph, found, walked, first.labels),
    };
}
export function compile(result, view) {
    const walked = walk(result.graph);
    const found = [...(result.paths ?? bugs(result.graph, walked))].sort(shortestFirst);
    for (const p of result.properties)
        if (p.bug)
            found.push({ rule: p.rule, ...p.bug });
    const { chart, stories } = found.length || !result.paths
        ? project(result.graph, walked, view, found)
        : { chart: undefined, stories: new Map() };
    const text = report(result, found, chart, stories);
    const files = new Map();
    if (chart)
        files.set("chart.mmd", inParts(mermaidLines(chart)));
    files.set("report.md", [text]);
    files.set("tlc.out", plainText(result.messages));
    const drawn = new Set();
    for (const b of found)
        if (b.rule.kind !== "property")
            drawn.add(ruleKey(b.rule));
    for (const { rule, outcome, messages } of [...result.rules, ...result.properties])
        if (outcome === "broken" && messages && !drawn.has(ruleKey(rule)))
            files.set(`tlc-${rule.name}.out`, plainText(messages));
    return { report: text, files, exit: result.exit };
}
