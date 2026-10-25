// Word-level comparison of two texts: what was kept, removed and added.
// Used to show a draft's changes and to check that every change has a reason.

export interface DiffPart {
  type: "same" | "removed" | "added";
  text: string;
}

/** One stretch of change, with its position in both texts. */
export interface Region {
  origStart: number;
  origEnd: number;
  draftStart: number;
  draftEnd: number;
}

/** Words, runs of spaces, and single punctuation marks. */
function tokenize(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

/** Longest-common-subsequence diff on tokens. Fine for UI copy (a few hundred words). */
export function diffWords(original: string, draft: string): DiffPart[] {
  const a = tokenize(original);
  const b = tokenize(draft);
  const n = a.length;
  const m = b.length;
  // lengths[i][j] = LCS length of a[i:] and b[j:]
  const lengths: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts.at(-1);
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      push("removed", a[i++]);
    } else {
      push("added", b[j++]);
    }
  }
  while (i < n) push("removed", a[i++]);
  while (j < m) push("added", b[j++]);
  return absorbSpaces(parts);
}

/**
 * A lone space kept between two changes splits one edit into two ("not
 * guaranteed" → "may go"). Folding such spaces into the change makes each
 * edit read as one.
 */
function absorbSpaces(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    const prev = out.at(-1);
    const next = parts[k + 1];
    if (part.type === "same" && /^\s+$/.test(part.text) && prev && prev.type !== "same" && next && next.type !== "same") {
      out.push({ type: "removed", text: part.text }, { type: "added", text: part.text });
      continue;
    }
    out.push({ ...part });
  }
  // Re-merge neighbours of the same type, keeping removed before added within a change.
  const merged: DiffPart[] = [];
  let removed = "";
  let added = "";
  const flush = () => {
    if (removed) merged.push({ type: "removed", text: removed });
    if (added) merged.push({ type: "added", text: added });
    removed = "";
    added = "";
  };
  for (const part of out) {
    if (part.type === "removed") removed += part.text;
    else if (part.type === "added") added += part.text;
    else {
      flush();
      const last = merged.at(-1);
      if (last && last.type === "same") last.text += part.text;
      else merged.push({ ...part });
    }
  }
  flush();
  return merged;
}

/** Each stretch of change between kept text, with positions in both texts. */
export function changedRegions(parts: DiffPart[]): Region[] {
  const regions: Region[] = [];
  let orig = 0;
  let draft = 0;
  let current: Region | null = null;
  for (const part of parts) {
    if (part.type === "same") {
      if (current) regions.push(current);
      current = null;
      orig += part.text.length;
      draft += part.text.length;
      continue;
    }
    current ??= { origStart: orig, origEnd: orig, draftStart: draft, draftEnd: draft };
    if (part.type === "removed") {
      orig += part.text.length;
      current.origEnd = orig;
    } else {
      draft += part.text.length;
      current.draftEnd = draft;
    }
  }
  if (current) regions.push(current);
  return regions;
}
