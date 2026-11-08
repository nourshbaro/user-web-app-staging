/**
 * Turns a legal document as published by the backend (an HTML fragment or
 * plain text) into presentation blocks: headings, paragraphs and lists, with
 * bold runs kept. Only structure is read; no markup is executed or rendered
 * as HTML. Pure module so it can be tested under Node.
 */

export type LegalRun = { text: string; strong: boolean };

export type LegalBlock =
  | { kind: "heading"; runs: LegalRun[] }
  | { kind: "paragraph"; runs: LegalRun[] }
  | { kind: "list"; ordered: boolean; items: LegalRun[][] };

const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9]*)\b[^>]*>|([^<]+|<)/gi;
const BLOCK_TAGS = new Set(["p", "div", "section", "article", "header", "footer", "blockquote"]);
const HEADING_TAG = /^h[1-6]$/;

export function parseLegalDocument(source: string): LegalBlock[] {
  if (!/<\/?[a-z][a-z0-9]*\b[^>]*>/i.test(source)) return parsePlainText(source);

  const blocks: LegalBlock[] = [];
  let runs: LegalRun[] = [];
  let heading = false;
  let list: { ordered: boolean; items: LegalRun[][] } | null = null;
  let listDepth = 0;
  let strongDepth = 0;

  const flush = () => {
    const content = trimRuns(runs);
    runs = [];
    if (!content.length) return;
    if (list) list.items.push(content);
    else blocks.push({ kind: heading ? "heading" : "paragraph", runs: content });
  };

  const append = (raw: string, preserveBreak = false) => {
    const last = runs[runs.length - 1];
    let text = preserveBreak ? raw : raw.replace(/\s+/g, " ");
    if (!preserveBreak && (!last || /[ \n]$/.test(last.text))) text = text.replace(/^ /, "");
    if (!text) return;
    const strong = strongDepth > 0;
    if (last && last.strong === strong) last.text += text;
    else runs.push({ text, strong });
  };

  for (const match of source.matchAll(TOKEN)) {
    const [, closing, rawTag, text] = match;
    if (text !== undefined) {
      append(decodeEntities(text));
      continue;
    }
    if (!rawTag) continue; // comment
    const tag = rawTag.toLowerCase();
    if (HEADING_TAG.test(tag)) {
      flush();
      heading = !closing;
    } else if (BLOCK_TAGS.has(tag) || tag === "li") {
      flush();
    } else if (tag === "ul" || tag === "ol") {
      flush();
      if (closing) {
        listDepth = Math.max(0, listDepth - 1);
        if (listDepth === 0 && list) {
          if (list.items.length) blocks.push({ kind: "list", ...list });
          list = null;
        }
      } else {
        // Nested lists are flattened into the outermost one.
        if (listDepth === 0) list = { ordered: tag === "ol", items: [] };
        listDepth += 1;
      }
    } else if (tag === "br") {
      append("\n", true);
    } else if (tag === "strong" || tag === "b") {
      strongDepth = closing ? Math.max(0, strongDepth - 1) : strongDepth + 1;
    }
  }
  flush();
  if (list && list.items.length) blocks.push({ kind: "list", ...list });
  return blocks;
}

function parsePlainText(source: string): LegalBlock[] {
  return source
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((part) => part.replace(/[ \t]*\n[ \t]*/g, "\n").trim())
    .filter(Boolean)
    .map((text) => ({ kind: "paragraph" as const, runs: [{ text: decodeEntities(text), strong: false }] }));
}

/** Drops spaces at block edges and around line breaks, then empty runs. */
function trimRuns(runs: LegalRun[]): LegalRun[] {
  const trimmed = runs.map((run) => ({ ...run, text: run.text.replace(/ *\n */g, "\n") }));
  if (trimmed.length) {
    trimmed[0].text = trimmed[0].text.replace(/^\s+/, "");
    const last = trimmed[trimmed.length - 1];
    last.text = last.text.replace(/\s+$/, "");
  }
  return trimmed.filter((run) => run.text.length > 0);
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—", hellip: "…", bull: "•",
  copy: "©", reg: "®", trade: "™",
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}
