const URLS = {
  products: "https://functions.poehali.dev/ab453741-d994-4115-9a77-276036d19dbd",
  orders: "https://functions.poehali.dev/92fb1cdd-4b87-4bcb-8154-75a499dd1745",
  builds: "https://functions.poehali.dev/6a3fdc40-04ab-4ef6-932b-4b24e530ee98",
  auth: "https://functions.poehali.dev/edc2010c-4d58-425e-8c01-0ea5459331e3",
  articles: "https://functions.poehali.dev/f13f1242-55c3-4265-9f6e-bb883371a574",
  syncProducts: "https://functions.poehali.dev/ff85a867-9bf3-416f-aaff-91d6a852f031",
  tags: "https://functions.poehali.dev/52e8165b-43fb-4ed1-a088-53cd09447d2e",
}

function authHeaders(session?: string | null) {
  const h: Record<string, string> = { "Content-Type": "application/json" }
  if (session) h["X-Session-Id"] = session
  return h
}

export const api = {
  products: {
    getAll: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : ""
      return fetch(URLS.products + qs).then(r => r.json())
    },
    getById: (id: number) => fetch(`${URLS.products}?id=${id}`).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.products, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.products, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    patch: (data: unknown) => fetch(URLS.products, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.products}?id=${id}`, { method: "DELETE" }).then(r => r.json()),
  },
  configurator: {
    getSlots: () => fetch(`${URLS.products}?resource=slots`).then(r => r.json()),
    create: (data: unknown) => fetch(`${URLS.products}?resource=slots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(`${URLS.products}?resource=slots`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    patch: (data: unknown) => fetch(`${URLS.products}?resource=slots`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  },
  orders: {
    create: (data: unknown) => fetch(URLS.orders, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    getAll: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : ""
      return fetch(URLS.orders + qs).then(r => r.json())
    },
    updateStatus: (data: unknown) => fetch(URLS.orders, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    getMyOrders: (session: string) => fetch(`${URLS.orders}?my=true`, { headers: { "X-Session-Id": session } }).then(r => r.json()),
    createWithSession: (data: unknown, session?: string | null) => fetch(URLS.orders, { method: "POST", headers: { "Content-Type": "application/json", ...(session ? { "X-Session-Id": session } : {}) }, body: JSON.stringify(data) }).then(r => r.json()),
  },
  builds: {
    getAll: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : ""
      return fetch(URLS.builds + qs).then(r => r.json())
    },
    getByClientToken: (token: string) => fetch(`${URLS.builds}?client_token=${token}`).then(r => r.json()),
    getVariants: (parentId: number) => fetch(`${URLS.builds}?parent_id=${parentId}`).then(r => r.json()),
    getByUserId: (userId: number) => fetch(`${URLS.builds}?user_id=${userId}`).then(r => r.json()),
    getById: (id: number) => fetch(`${URLS.builds}?id=${id}`).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.builds, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.builds, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    patch: (data: unknown) => fetch(URLS.builds, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    generateClientLink: (id: number) => fetch(URLS.builds, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate_client_link", id }) }).then(r => r.json()),
    claimBuild: (clientToken: string, session: string) => fetch(URLS.builds, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Session-Id": session }, body: JSON.stringify({ action: "claim", client_token: clientToken }) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.builds}?id=${id}`, { method: "DELETE" }).then(r => r.json()),
  },
  syncProducts: {
    exportExcel: () => fetch(URLS.syncProducts).then(r => r.json()),
    importExcel: (file_b64: string) => fetch(URLS.syncProducts, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", file_b64 }) }).then(r => r.json()),
    syncFromApi: (api_url: string, api_key: string) => fetch(URLS.syncProducts, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", api_url, api_key }) }).then(r => r.json()),
    previewApi: (api_url: string, api_key: string) => fetch(URLS.syncProducts, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", api_url, api_key }) }).then(r => r.json()),
  },
  articles: {
    getAll: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : ""
      return fetch(URLS.articles + qs).then(r => r.json())
    },
    getById: (id: number) => fetch(`${URLS.articles}?id=${id}`).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.articles, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.articles, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.articles}?id=${id}`, { method: "DELETE" }).then(r => r.json()),
  },
  tags: {
    getAll: () => fetch(URLS.tags).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.tags, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.tags, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.tags}?id=${id}`, { method: "DELETE" }).then(r => r.json()),
    setForBuild: (buildId: number, tagIds: number[]) => fetch(URLS.builds, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_tags", id: buildId, tag_ids: tagIds }) }).then(r => r.json()),
  },
  auth: {
    register: (data: unknown) => fetch(`${URLS.auth}/register`, { method: "POST", headers: authHeaders(), body: JSON.stringify(data) }).then(r => r.json()),
    login: (data: unknown) => fetch(`${URLS.auth}/login`, { method: "POST", headers: authHeaders(), body: JSON.stringify(data) }).then(r => r.json()),
    me: (session: string) => fetch(`${URLS.auth}/me`, { headers: authHeaders(session) }).then(r => r.json()),
    logout: (session: string) => fetch(`${URLS.auth}/logout`, { method: "POST", headers: authHeaders(session) }).then(r => r.json()),
    getBuilds: (session: string) => fetch(`${URLS.auth}/builds`, { headers: authHeaders(session) }).then(r => r.json()),
    getCommunityBuilds: () => fetch(`${URLS.auth}/builds/community`).then(r => r.json()),
    getBuildByToken: (token: string) => fetch(`${URLS.auth}/builds?token=${token}`).then(r => r.json()),
    saveUserBuild: (data: unknown, session: string) => fetch(`${URLS.auth}/builds`, { method: "POST", headers: authHeaders(session), body: JSON.stringify(data) }).then(r => r.json()),
    updateUserBuild: (data: unknown, session: string) => fetch(`${URLS.auth}/builds`, { method: "PUT", headers: authHeaders(session), body: JSON.stringify(data) }).then(r => r.json()),
  },
}