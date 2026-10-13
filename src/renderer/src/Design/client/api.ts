const DESIGN_STORAGE_KEY = "examguard.design-lab.local";

function isElectronRuntime() {
  return typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent)
    || typeof window !== "undefined" && window.location?.protocol === "file:";
}

function readLocalDesignStore() {
  try {
    const raw = localStorage.getItem(DESIGN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { designs: [], templates: [] };
  } catch {
    return { designs: [], templates: [] };
  }
}

function writeLocalDesignStore(store: { designs: any[]; templates: any[] }) {
  localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(store));
}

function uid(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildDesignRecord(payload: Record<string, any>) {
  const width = Number(payload.width) || 1200;
  const height = Number(payload.height) || 800;
  return {
    id: payload.id || uid("design"),
    name: typeof payload.name === "string" ? payload.name : "Untitled Design",
    canvas_json: payload.canvas_json || "{}",
    width,
    height,
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: payload.updatedAt || new Date().toISOString(),
    pages: payload.pages || [
      {
        id: uid("page"),
        title: "Page 1",
        sort_order: 0,
        canvas_json: payload.canvas_json || "{}",
      },
    ],
  };
}

function buildPageRecord(designId: string, payload: Record<string, any> = {}, existingPages: any[] = []) {
  const next = {
    id: payload.id || uid("page"),
    title: typeof payload.title === "string" ? payload.title : `Page ${existingPages.length + 1}`,
    sort_order: Number.isFinite(payload.sort_order) ? payload.sort_order : existingPages.length,
    canvas_json: payload.canvas_json || "{}",
    designId,
  };
  return next;
}

async function localStorageApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const store = readLocalDesignStore();
  const match = path.match(/^\/api\/(.*)$/);
  const remainder = match ? match[1] : path;

  if (method === "GET" && remainder === "designs") {
    return store.designs as T;
  }

  if (method === "GET" && remainder === "templates") {
    return (store.templates || []) as T;
  }

  if (method === "POST" && remainder === "designs") {
    const payload = (body || {}) as Record<string, any>;
    const design = buildDesignRecord({ ...payload, id: uid("design") });
    store.designs = [design, ...store.designs];
    writeLocalDesignStore(store);
    return design as T;
  }

  if (method === "GET" && remainder.startsWith("designs/")) {
    const designId = remainder.replace(/^designs\//, "");
    const design = store.designs.find((item) => item.id === designId);
    if (!design) throw new Error("Design not found");
    const pages = design.pages?.length ? design.pages : [{
      id: uid("page"),
      title: "Page 1",
      sort_order: 0,
      canvas_json: design.canvas_json || "{}",
      designId: design.id,
    }];
    return {
      ...design,
      pages,
    } as T;
  }

  if (method === "PUT" && remainder.startsWith("designs/")) {
    const designId = remainder.replace(/^designs\//, "").split("/")[0];
    const payload = (body || {}) as Record<string, any>;
    const index = store.designs.findIndex((item) => item.id === designId);
    if (index === -1) throw new Error("Design not found");
    const updated = {
      ...store.designs[index],
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    store.designs[index] = updated;
    writeLocalDesignStore(store);
    return updated as T;
  }

  if (method === "DELETE" && remainder.startsWith("designs/")) {
    const designId = remainder.replace(/^designs\//, "").split("/")[0];
    store.designs = store.designs.filter((item) => item.id !== designId);
    writeLocalDesignStore(store);
    return { ok: true } as T;
  }

  if (method === "POST" && remainder.startsWith("designs/") && remainder.includes("/pages")) {
    const designId = remainder.replace(/^designs\//, "").split("/pages")[0];
    const design = store.designs.find((item) => item.id === designId);
    if (!design) throw new Error("Design not found");
    const page = buildPageRecord(designId, body as Record<string, any>, design.pages || []);
    const pages = [...(design.pages || []), page];
    design.pages = pages;
    design.updatedAt = new Date().toISOString();
    writeLocalDesignStore(store);
    return page as T;
  }

  if (method === "GET" && remainder.startsWith("pages/")) {
    const pageId = remainder.replace(/^pages\//, "");
    for (const design of store.designs) {
      const page = (design.pages || []).find((item) => item.id === pageId);
      if (page) return page as T;
    }
    throw new Error("Page not found");
  }

  if (method === "PUT" && remainder.startsWith("pages/")) {
    const pageId = remainder.replace(/^pages\//, "");
    let updatedPage: any = null;
    for (const design of store.designs) {
      const index = (design.pages || []).findIndex((item) => item.id === pageId);
      if (index !== -1) {
        updatedPage = {
          ...(design.pages || [])[index],
          ...(body || {}),
        };
        (design.pages || [])[index] = updatedPage;
        design.updatedAt = new Date().toISOString();
        writeLocalDesignStore(store);
        return updatedPage as T;
      }
    }
    throw new Error("Page not found");
  }

  if (method === "DELETE" && remainder.startsWith("pages/")) {
    const pageId = remainder.replace(/^pages\//, "");
    for (const design of store.designs) {
      design.pages = (design.pages || []).filter((item) => item.id !== pageId);
      design.updatedAt = new Date().toISOString();
    }
    writeLocalDesignStore(store);
    return { ok: true } as T;
  }

  if (method === "POST" && remainder.startsWith("pages/") && remainder.includes("/duplicate")) {
    const pageId = remainder.replace(/^pages\//, "").replace(/\/duplicate$/, "");
    for (const design of store.designs) {
      const page = (design.pages || []).find((item) => item.id === pageId);
      if (page) {
        const clone = { ...page, id: uid("page"), title: `${page.title} Copy`, sort_order: (design.pages || []).length };
        design.pages = [...(design.pages || []), clone];
        design.updatedAt = new Date().toISOString();
        writeLocalDesignStore(store);
        return clone as T;
      }
    }
    throw new Error("Page not found");
  }

  throw new Error(`Unsupported local design API request: ${method} ${path}`);
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (isElectronRuntime()) {
    return localStorageApi<T>(method, path, body);
  }
  const opts: RequestInit = { method, headers: {} };
  if (body) {
    (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}
