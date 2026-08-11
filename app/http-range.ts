export type ParsedByteRange =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "range"; start: number; end: number; length: number };

export function parseByteRange(value: string | null, size: number): ParsedByteRange {
  if (!value || !value.trim()) return { kind: "none" };
  const match = /^\s*bytes\s*=\s*(.+)\s*$/i.exec(value);
  // Unknown range units are ignored per HTTP semantics.
  if (!match) return { kind: "none" };
  const specification = match[1].trim();
  // This endpoint intentionally supports one range. A valid multi-range request
  // may be ignored and served in full instead of being misreported as
  // unsatisfiable.
  if (specification.includes(",")) return { kind: "none" };
  if (!specification || size <= 0) return { kind: "invalid" };
  const parts = /^(\d*)-(\d*)$/.exec(specification);
  if (!parts || (!parts[1] && !parts[2])) return { kind: "invalid" };

  let start: number;
  let end: number;
  if (!parts[1]) {
    const suffixLength = Number(parts[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: "invalid" };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(parts[1]);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return { kind: "invalid" };
    if (parts[2]) {
      end = Number(parts[2]);
      if (!Number.isSafeInteger(end) || end < start) return { kind: "invalid" };
      end = Math.min(end, size - 1);
    } else {
      end = size - 1;
    }
  }
  return { kind: "range", start, end, length: end - start + 1 };
}
