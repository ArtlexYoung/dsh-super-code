import { CHART_STATES, RERUN_STATES } from "../ir.mjs";
export function configText(sections, extra) {
    const lines = [];
    for (const s of sections)
        lines.push(`${s.key} ${s.tokens.join(" ")}`);
    lines.push(...extra);
    return lines.join("\n");
}
export const boundRun = (module) => [
    `---- MODULE ChartBound ----`,
    `EXTENDS ${module}`,
    `ChartTLC == INSTANCE TLC`,
    `ChartNaturals == INSTANCE Naturals`,
    `ChartBound == ChartNaturals!<(ChartTLC!TLCGet("distinct"), ${RERUN_STATES})`,
    `====`,
].join("\n");
export function chartRun({ module, variables, invariants }, tag) {
    const every = [];
    for (const name of invariants)
        every.push(`(IF ~${name} THEN {"${name}"} ELSE {}) \\cup `);
    return [
        `---- MODULE ChartRun ----`,
        `EXTENDS ${module}`,
        `ChartTLC == INSTANCE TLC`,
        `ChartNaturals == INSTANCE Naturals`,
        `ChartBudget == ChartNaturals!<=(ChartTLC!TLCGet("distinct"), ${CHART_STATES})`,
        `ChartBroken == ${every.join("")}{}`,
        `ChartMark == ChartBroken = {} \\/ ChartTLC!PrintT(<<"${tag}", <<${variables.join(", ")}>>, ChartBroken>>)`,
        `====`,
    ].join("\n");
}
