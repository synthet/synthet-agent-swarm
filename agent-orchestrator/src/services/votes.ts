export interface JudgeText {
  agent: string;
  text: string;
}

export interface FieldAgreement {
  value: string | null;
  counts: Record<string, number>;
  disputed: boolean;
  answered: number;
}

export interface ItemAgreement {
  votes: Record<string, Record<string, string>>;
  fields: Record<string, FieldAgreement>;
}

export interface SwarmAgreement {
  parsedAgents: string[];
  unparsedAgents: string[];
  items: Record<string, ItemAgreement>;
  note: string;
}

const GROUND_TRUTH =
  "Agent-panel labels are not ground truth. A field is agreed only when at least two judges share a strict majority. Ties and single votes stay disputed.";

const ID_KEYS = new Set(["id", "image_id", "key"]);

export function emptyAgreement(reason: string): SwarmAgreement {
  return {
    parsedAgents: [],
    unparsedAgents: [],
    items: {},
    note: `${reason} ${GROUND_TRUTH}`,
  };
}

export function extractLastJsonObject(
  text: string,
): Record<string, unknown> | null {
  let last: Record<string, unknown> | null = null;
  let lastWithImages: Record<string, unknown> | null = null;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const raw = balancedObject(text, i);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      last = data as Record<string, unknown>;
      if (Array.isArray(last.images)) lastWithImages = last;
    } catch {
      continue;
    }
  }

  return lastWithImages ?? last;
}

export function agreeVotes(replies: JudgeText[]): SwarmAgreement {
  const parsedAgents: string[] = [];
  const unparsedAgents: string[] = [];
  const items: Record<string, ItemAgreement> = {};

  for (const reply of replies) {
    const obj = extractLastJsonObject(reply.text);
    const rows = obj ? rowsFrom(obj) : null;
    if (!rows) {
      unparsedAgents.push(reply.agent);
      continue;
    }
    parsedAgents.push(reply.agent);
    for (const row of rows) {
      const item = items[row.id] ?? { votes: {}, fields: {} };
      item.votes[reply.agent] = row.fields;
      items[row.id] = item;
    }
  }

  for (const item of Object.values(items)) {
    const fieldNames = new Set<string>();
    for (const vote of Object.values(item.votes)) {
      for (const key of Object.keys(vote)) fieldNames.add(key);
    }
    for (const field of fieldNames) {
      const values = Object.values(item.votes)
        .map((vote) => vote[field])
        .filter((value): value is string => Boolean(value));
      item.fields[field] = agreeField(values);
    }
  }

  return { parsedAgents, unparsedAgents, items, note: GROUND_TRUTH };
}

function rowsFrom(
  obj: Record<string, unknown>,
): Array<{ id: string; fields: Record<string, string> }> | null {
  if (Array.isArray(obj.images)) {
    const rows: Array<{ id: string; fields: Record<string, string> }> = [];
    for (const row of obj.images) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;
      const id = rowId(record);
      if (!id) continue;
      rows.push({ id, fields: stringFields(record) });
    }
    return rows;
  }

  const fields = stringFields(obj);
  if (Object.keys(fields).length === 0) return null;
  return [{ id: "_reply", fields }];
}

function rowId(row: Record<string, unknown>): string | null {
  for (const key of ID_KEYS) {
    const value = row[key];
    if (value === undefined || value === null || value === "") continue;
    return String(value);
  }
  return null;
}

function stringFields(row: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (ID_KEYS.has(key)) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) fields[key] = trimmed;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      fields[key] = String(value);
    }
  }
  return fields;
}

function agreeField(values: string[]): FieldAgreement {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  const ranked = Object.entries(counts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const top = ranked[0];
  const second = ranked[1];
  const agreed = Boolean(top && top[1] >= 2 && (!second || top[1] > second[1]));
  return {
    value: agreed ? top![0] : null,
    counts,
    disputed: !agreed,
    answered: values.length,
  };
}

function balancedObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}
