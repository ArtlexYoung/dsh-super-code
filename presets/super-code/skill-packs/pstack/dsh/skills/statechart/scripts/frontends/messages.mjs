import { linesOf, parseState } from "./dot.mjs";
const START = /@!@!@STARTMSG (\d+):(\d+) @!@!@$/;
const END = /^@!@!@ENDMSG \d+ @!@!@$/;
const isCutMarker = (lastLine) => lastLine.startsWith("@!@!@");
function cutMessage(open) {
    for (let i = open.length - 1; i > 0 && !open[i].body.length; i--)
        open[i - 1].body.pop();
    return open[0]?.body.length ? open[0] : undefined;
}
export function* readMessages(tlcOut) {
    const lines = linesOf(tlcOut)[Symbol.iterator]();
    const open = [];
    try {
        for (let next = lines.next(); !next.done;) {
            const line = next.value;
            next = lines.next();
            if (next.done && (!line || isCutMarker(line)))
                break;
            const start = START.exec(line);
            if (start) {
                const message = { code: Number(start[1]), level: Number(start[2]), body: [] };
                if (start.index)
                    message.beforeMarker = line.slice(0, start.index);
                open.at(-1)?.body.push(message);
                open.push(message);
            }
            else if (END.test(line)) {
                const done = open.pop();
                if (done && !open.length)
                    yield done;
            }
            else if (open.length)
                open[open.length - 1].body.push(line);
            else
                yield line;
        }
    }
    finally {
        lines.return?.();
    }
    const cut = cutMessage(open);
    if (cut)
        yield cut;
}
export const textOf = ({ body }) => body.filter((part) => typeof part === "string").join("\n");
export const actionOf = (m) => /^\d+: (?:Back to state: )?<([^\s>]+)/.exec(textOf(m))?.[1];
export const messageState = (m) => {
    const lines = textOf(m).split("\n");
    const body = [];
    for (let i = 1; i < lines.length && lines[i].trim(); i++)
        body.push(lines[i]);
    return parseState(body.join("\n"));
};
