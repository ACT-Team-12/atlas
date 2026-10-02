/**
 * Finds care items in the model's JSON while it is still being written.
 *
 * The model writes one JSON object: { "source_text": ..., "items": [ {...}, {...} ], ... }.
 * This scanner walks the text as it arrives and hands back the exact text of each object inside
 * the top-level "items" array, but only once that object's closing brace has arrived. It tracks
 * strings and escapes, so braces or quotes inside a quote never confuse it. A half-written item is
 * never returned, and nothing outside "items" is ever returned.
 */
export class ItemScanner {
  private buf = "";
  private at = 0;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private stringStart = -1;
  private lastTopString: string | null = null; // last finished string directly inside the top object
  private key: string | null = null; // the top-level key whose value is being written
  private inItems = false;
  private itemStart = -1;
  private count = 0;

  /** How many complete items have been returned so far. */
  get found() {
    return this.count;
  }

  /** Adds more text and returns the raw JSON of every item completed by it, in order. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    for (; this.at < this.buf.length; this.at++) {
      const c = this.buf[this.at];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === "\\") this.escaped = true;
        else if (c === '"') {
          this.inString = false;
          if (this.depth === 1) this.lastTopString = this.buf.slice(this.stringStart, this.at + 1);
        }
        continue;
      }
      switch (c) {
        case '"':
          this.inString = true;
          this.stringStart = this.at;
          break;
        case ":":
          if (this.depth === 1) this.key = readKey(this.lastTopString);
          break;
        case ",":
          if (this.depth === 1) this.key = null;
          break;
        case "{":
        case "[":
          this.depth++;
          if (c === "[" && this.depth === 2 && this.key === "items") this.inItems = true;
          else if (c === "{" && this.inItems && this.depth === 3) this.itemStart = this.at;
          break;
        case "}":
        case "]":
          if (c === "}" && this.inItems && this.depth === 3 && this.itemStart >= 0) {
            out.push(this.buf.slice(this.itemStart, this.at + 1));
            this.itemStart = -1;
            this.count++;
          } else if (c === "]" && this.inItems && this.depth === 2) {
            this.inItems = false;
          }
          this.depth--;
          break;
      }
    }
    return out;
  }
}

function readKey(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}
