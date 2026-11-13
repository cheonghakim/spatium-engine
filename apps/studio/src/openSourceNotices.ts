/**
 * Structured view of THIRD_PARTY_NOTICES.md for the Studio license dialog.
 * The markdown file stays the single source of truth (it also ships in the
 * SDK's dist/); this only reads two parts of it:
 *  - the "### Spatium Studio" table — what is bundled into this app;
 *  - the "## License texts" section — one "### <title>" + fenced block each.
 */

export interface NoticeComponent {
  name: string;
  url: string;
  version: string;
  license: string;
  purpose: string;
}

export interface NoticeLicenseText {
  title: string;
  /** Prose between the heading and the fenced block (e.g. what the license covers). */
  note: string;
  text: string;
}

export interface ParsedNotices {
  components: NoticeComponent[];
  licenses: NoticeLicenseText[];
}

const TABLE_ROW = /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/;

function sectionAfter(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return [];
  const level = /^#+/.exec(lines[start] as string)?.[0].length ?? 2;
  const rest = lines.slice(start + 1);
  // License texts are verbatim and may contain "# ..." lines of their own
  // (e.g. the MDI license), so headings inside fenced blocks don't count.
  let inFence = false;
  const end = rest.findIndex((line) => {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence) return false;
    const hashes = /^(#+)\s/.exec(line)?.[1]?.length;
    return hashes !== undefined && hashes <= level;
  });
  return end === -1 ? rest : rest.slice(0, end);
}

/** Returns null when the file no longer has the expected shape, so the caller can fall back to raw text. */
export function parseNotices(markdown: string): ParsedNotices | null {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  const components: NoticeComponent[] = [];
  for (const line of sectionAfter(lines, /^###\s+Spatium Studio\b/)) {
    const match = TABLE_ROW.exec(line);
    if (!match) continue;
    components.push({
      name: match[1]!.trim(),
      url: match[2]!.trim(),
      version: match[3]!.trim(),
      license: match[4]!.trim(),
      purpose: match[5]!.trim(),
    });
  }

  const licenses: NoticeLicenseText[] = [];
  let current: { title: string; note: string[]; text: string[] } | null = null;
  let inFence = false;
  for (const line of sectionAfter(lines, /^##\s+License texts\b/)) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      current?.text.push(line);
      continue;
    }
    // A horizontal rule ends the license texts; what follows is maintainer guidance.
    if (line.trim() === "---") break;
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      if (current) licenses.push(finish(current));
      current = { title: heading[1]!.trim(), note: [], text: [] };
    } else if (current && line.trim()) {
      current.note.push(line.trim());
    }
  }
  if (current) licenses.push(finish(current));

  if (components.length === 0 || licenses.length === 0) return null;
  return { components, licenses };
}

function finish(entry: { title: string; note: string[]; text: string[] }): NoticeLicenseText {
  return {
    title: entry.title,
    note: entry.note.join(" ").replace(/`/g, ""),
    text: entry.text.join("\n").trim(),
  };
}
