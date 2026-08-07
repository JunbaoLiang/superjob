// 批量导入的纯核心：解析输入、保守去重、可见串行队列。
// 不读取真实职位、不发网络请求，也不决定是否投递。

const TRACKING_PARAM = /^(utm_[^=]*|ref|source|campaign|fbclid|gclid)$/i;

function normalizedText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeJobUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    const pairs = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
    url.search = "";
    for (const [key, param] of pairs) url.searchParams.append(key, param);
    return url.toString().replace(/\?$/, "");
  } catch {
    return null;
  }
}

function sameIdentity(a, b) {
  return ["company", "title", "location"].every((key) => {
    const left = normalizedText(a[key]);
    const right = normalizedText(b[key]);
    return left && left === right;
  });
}

function sameCompanyTitle(a, b) {
  return ["company", "title"].every((key) => {
    const left = normalizedText(a[key]);
    const right = normalizedText(b[key]);
    return left && left === right;
  });
}

/**
 * 只将确定重复自动拦下。公司/职位相同但 URL 或地点不同，必须可见地交给用户确认。
 */
export function classifyDuplicate(candidate, existing) {
  const normalizedUrl = normalizeJobUrl(candidate?.url);
  const rows = Array.isArray(existing) ? existing : [];
  if (normalizedUrl) {
    const found = rows.find((row) => normalizeJobUrl(row?.url) === normalizedUrl);
    if (found) return { kind: "duplicate", match: "url", id: found.id };
  }
  if (!normalizedUrl) {
    const found = rows.find((row) => !normalizeJobUrl(row?.url) && sameIdentity(candidate, row));
    if (found) return { kind: "duplicate", match: "identity", id: found.id };
  }
  const possible = rows.filter((row) => sameCompanyTitle(candidate, row)).map((row) => row.id);
  return possible.length ? { kind: "possible-duplicate", match: "company-title", ids: possible } : { kind: "new" };
}

/** Split pasted content into either one URL or one JD text block per item. */
export function parseBatchInput(value) {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n\s*\r?\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const url = normalizeJobUrl(chunk);
      return url && /^https?:\/\/\S+$/i.test(chunk) ? { kind: "url", url: chunk } : { kind: "text", text: chunk };
    });
}

/** In-memory serial queue. Integration layers decide how a queued input becomes a job. */
export class BatchImportQueue {
  #worker;
  #items = new Map();
  #order = [];
  #draining = false;
  #nextId = 1;

  constructor(worker) {
    if (typeof worker !== "function") throw new Error("batch queue requires a worker");
    this.#worker = worker;
  }

  enqueueMany(payloads) {
    if (!Array.isArray(payloads)) throw new Error("batch items must be an array");
    return payloads.map((payload) => {
      const item = { id: `batch-${this.#nextId++}`, payload, state: "queued", result: null, error: null, attempts: 0 };
      this.#items.set(item.id, item);
      this.#order.push(item.id);
      return { ...item };
    });
  }

  get(id) {
    const item = this.#items.get(id);
    if (!item) throw new Error(`batch item not found: ${id}`);
    return item;
  }

  list() {
    return this.#order.map((id) => ({ ...this.get(id) }));
  }

  retry(id) {
    const item = this.get(id);
    if (item.state !== "failed") throw new Error("only failed batch items can be retried");
    item.state = "queued";
    item.error = null;
    this.#order.push(id);
    return { ...item };
  }

  async drain() {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (true) {
        const id = this.#order.find((itemId) => this.get(itemId).state === "queued");
        if (!id) return;
        const item = this.get(id);
        item.state = "running";
        item.attempts++;
        try {
          item.result = await this.#worker(item);
          item.error = null;
          item.state = "succeeded";
        } catch (error) {
          item.result = null;
          item.error = error instanceof Error ? error.message : String(error);
          item.state = "failed";
        }
      }
    } finally {
      this.#draining = false;
    }
  }
}
