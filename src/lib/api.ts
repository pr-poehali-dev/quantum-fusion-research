const URLS = {
  products: "https://functions.poehali.dev/ab453741-d994-4115-9a77-276036d19dbd",
  orders: "https://functions.poehali.dev/92fb1cdd-4b87-4bcb-8154-75a499dd1745",
  builds: "https://functions.poehali.dev/6a3fdc40-04ab-4ef6-932b-4b24e530ee98",
  auth: "https://functions.poehali.dev/edc2010c-4d58-425e-8c01-0ea5459331e3",
  telegramAuth: "https://functions.poehali.dev/3fcf2e40-36d1-4064-99e2-3b422e0ca3f0",
  articles: "https://functions.poehali.dev/f13f1242-55c3-4265-9f6e-bb883371a574",
  syncProducts: "https://functions.poehali.dev/ff85a867-9bf3-416f-aaff-91d6a852f031",
  tags: "https://functions.poehali.dev/52e8165b-43fb-4ed1-a088-53cd09447d2e",
  wipBuilds: "https://functions.poehali.dev/cb6e9d4e-3de4-4aea-9f82-221c4a7cd6e3",
  cables: "https://functions.poehali.dev/36ee1587-5da6-4b91-88fc-a21796265d63",
  upload: "https://functions.poehali.dev/5d666dbd-55fd-470b-8b67-fa9fcf6ecd81",
  warehouse: "https://functions.poehali.dev/828a962b-2051-4152-bc1e-e8521b07c291",
  generateWarranty: "https://functions.poehali.dev/4f468c20-b028-4d53-8dad-affcf1b45618",
  comments: "https://functions.poehali.dev/dac98ba7-a8e7-4a0f-9d4e-9c8541a144ab",
  notifications: "https://functions.poehali.dev/58527d2a-e061-409c-b800-a935e34690c6",
  schedule: "https://functions.poehali.dev/10912f60-5fd3-4930-9724-ad4929621f72",
  rma: "https://functions.poehali.dev/6e92e4fb-4e76-42ee-88a7-0638374f9dcc",
  finance: "https://functions.poehali.dev/c96c7960-8abb-43f1-bdf1-191c8f3250fc",
  quiz: "https://functions.poehali.dev/8660d01d-f97e-4034-8704-30fd94dc3041",
  snArchive: "https://functions.poehali.dev/147bf909-3e68-44c2-bd73-5c6dc9b11195",
  priceMonitor: "https://functions.poehali.dev/505d6a55-4cdb-4d30-9e46-3292ad49b4ab",
  stress: "https://functions.poehali.dev/ffa7efcd-7a92-4a76-a463-abec515d846c",
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
    restore: (id: number) => fetch(URLS.products, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", id }) }).then(r => r.json()),
  },
  configurator: {
    getSlots: () => fetch(`${URLS.products}?resource=slots`).then(r => r.json()),
    create: (data: unknown) => fetch(`${URLS.products}?resource=slots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(`${URLS.products}?resource=slots`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    patch: (data: unknown) => fetch(`${URLS.products}?resource=slots`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  },
  tier: {
    getAll: (category?: string) => fetch(`${URLS.products}?resource=tier${category ? `&category=${encodeURIComponent(category)}` : ""}`).then(r => r.json()),
    save: (items: Array<{ id: number; tier_rank: string | null; tier_pos: number }>) =>
      fetch(`${URLS.products}?resource=tier`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }).then(r => r.json()),
  },
  brands: {
    getAll: () => fetch(`${URLS.products}?resource=brands`).then(r => r.json()),
    create: (data: { name: string; logo_url?: string; sort_order?: number }) => fetch(`${URLS.products}?resource=brands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: { id: number; name: string; logo_url?: string; sort_order?: number }) => fetch(`${URLS.products}?resource=brands`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.products}?resource=brands&id=${id}`, { method: "DELETE" }).then(r => r.json()),
  },
  orders: {
    create: (data: unknown) => fetch(URLS.orders, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    getAll: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : ""
      return fetch(URLS.orders + qs).then(r => r.json())
    },
    getById: (id: number) => fetch(`${URLS.orders}?id=${id}`).then(r => r.json()),
    updateItem: (data: unknown) => fetch(URLS.orders, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    updateStatus: (data: unknown) => fetch(URLS.orders, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    setPrepayment: (data: { id: number; prepayment_percent?: number; prepayment_amount?: number }) => fetch(URLS.orders, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_prepayment", ...data }) }).then(r => r.json()),
    getMyOrders: (session: string) => fetch(`${URLS.orders}?my=true`, { headers: { "X-Session-Id": session } }).then(r => r.json()),
    createWithSession: (data: unknown, session?: string | null) => fetch(URLS.orders, { method: "POST", headers: { "Content-Type": "application/json", ...(session ? { "X-Session-Id": session } : {}) }, body: JSON.stringify(data) }).then(r => r.json()),
  },
  priceMonitor: {
    list: (adminKey: string, kind?: string) =>
      fetch(`${URLS.priceMonitor}?action=list${kind ? `&kind=${kind}` : ""}`, { headers: { "X-Admin-Token": adminKey } }).then(r => r.json()),
    accept: (id: number, adminKey: string) =>
      fetch(URLS.priceMonitor, { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": adminKey }, body: JSON.stringify({ action: "accept", id }) }).then(r => r.json()),
    reject: (id: number, adminKey: string) =>
      fetch(URLS.priceMonitor, { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": adminKey }, body: JSON.stringify({ action: "reject", id }) }).then(r => r.json()),
    acceptAll: (adminKey: string) =>
      fetch(URLS.priceMonitor, { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": adminKey }, body: JSON.stringify({ action: "accept_all" }) }).then(r => r.json()),
  },
  builds: {
    getAll: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : ""
      return fetch(URLS.builds + qs).then(r => r.json())
    },
    getByClientToken: (token: string) => fetch(`${URLS.builds}?client_token=${token}`).then(r => r.json()),
    getByShortCode: (code: string) => fetch(`${URLS.builds}?short_code=${encodeURIComponent(code)}`).then(r => r.json()),
    getVariants: (parentId: number) => fetch(`${URLS.builds}?parent_id=${parentId}`).then(r => r.json()),
    getByUserId: (userId: number) => fetch(`${URLS.builds}?user_id=${userId}`).then(r => r.json()),
    getById: (id: number) => fetch(`${URLS.builds}?id=${id}`).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.builds, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.builds, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    patch: (data: unknown) => fetch(URLS.builds, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    generateClientLink: (id: number) => fetch(URLS.builds, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate_client_link", id }) }).then(r => r.json()),
    fromWip: (wipId: number) => fetch(URLS.builds, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "from_wip", wip_id: wipId }) }).then(r => r.json()),
    claimBuild: (clientToken: string, session: string) => fetch(URLS.builds, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Session-Id": session }, body: JSON.stringify({ action: "claim", client_token: clientToken }) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.builds}?id=${id}`, { method: "DELETE" }).then(r => r.json()),
  },
  syncProducts: {
    exportExcel: () => fetch(URLS.syncProducts).then(r => r.json()),
    importExcel: (file_b64: string) => fetch(URLS.syncProducts, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", file_b64 }) }).then(r => r.json()),
  },
  articles: {
    getAll: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : ""
      return fetch(URLS.articles + qs).then(r => r.json())
    },
    getById: (id: number, noview?: boolean) => fetch(`${URLS.articles}?id=${id}${noview ? "&noview=1" : ""}`).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.articles, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.articles, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.articles}?id=${id}`, { method: "DELETE" }).then(r => r.json()),
  },
  quiz: {
    getQuestions: (all?: boolean) => fetch(`${URLS.quiz}?resource=questions${all ? "&all=true" : ""}`).then(r => r.json()),
    submit: (data: unknown) => fetch(`${URLS.quiz}?resource=submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    createQuestion: (data: unknown) => fetch(`${URLS.quiz}?resource=questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    updateQuestion: (data: unknown) => fetch(`${URLS.quiz}?resource=questions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    deleteQuestion: (id: number) => fetch(`${URLS.quiz}?resource=questions&id=${id}`, { method: "DELETE" }).then(r => r.json()),
    getRequests: () => fetch(`${URLS.quiz}?resource=requests`).then(r => r.json()),
    setRequestStatus: (id: number, status: string) => fetch(`${URLS.quiz}?resource=requests`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) }).then(r => r.json()),
    deleteRequest: (id: number) => fetch(`${URLS.quiz}?resource=requests&id=${id}`, { method: "DELETE" }).then(r => r.json()),
  },
  tags: {
    getAll: () => fetch(URLS.tags).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.tags, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.tags, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.tags}?id=${id}`, { method: "DELETE" }).then(r => r.json()),
    setForBuild: (buildId: number, tagIds: number[]) => fetch(URLS.builds, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_tags", id: buildId, tag_ids: tagIds }) }).then(r => r.json()),
  },
  wipBuilds: {
    getAll: () => fetch(URLS.wipBuilds).then(r => r.json()),
    getById: (id: number) => fetch(`${URLS.wipBuilds}?id=${id}`).then(r => r.json()),
    getByOrderId: (orderId: number) => fetch(`${URLS.wipBuilds}?order_id=${orderId}`).then(r => r.json()),
    getByClientToken: (token: string) => fetch(`${URLS.wipBuilds}?client_token=${encodeURIComponent(token)}`).then(r => r.json()),
    getMargin: (wipId: number) => fetch(`${URLS.wipBuilds}?action=margin&id=${wipId}`).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.wipBuilds, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    ensureOrder: (wipId: number) => fetch(URLS.wipBuilds, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure_order", wip_id: wipId }) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.wipBuilds, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    patch: (data: unknown) => fetch(URLS.wipBuilds, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.wipBuilds}?id=${id}`, { method: "DELETE" }).then(r => r.json()),
  },
  auth: {
    register: (data: unknown) => fetch(`${URLS.auth}?action=register`, { method: "POST", headers: authHeaders(), body: JSON.stringify(data) }).then(r => r.json()),
    login: (data: unknown) => fetch(`${URLS.auth}?action=login`, { method: "POST", headers: authHeaders(), body: JSON.stringify(data) }).then(r => r.json()),
    me: (session: string) => fetch(`${URLS.auth}?action=me`, { headers: authHeaders(session) }).then(r => r.json()),
    logout: (session: string) => fetch(`${URLS.auth}?action=logout`, { method: "POST", headers: authHeaders(session) }).then(r => r.json()),
    getBuilds: (session: string) => fetch(`${URLS.auth}?action=builds`, { headers: authHeaders(session) }).then(r => r.json()),
    getCommunityBuilds: () => fetch(`${URLS.auth}?action=community`).then(r => r.json()),
    getBuildByToken: (token: string) => fetch(`${URLS.auth}?action=build&token=${token}`).then(r => r.json()),
    saveUserBuild: (data: unknown, session: string) => fetch(`${URLS.auth}?action=save_build`, { method: "POST", headers: authHeaders(session), body: JSON.stringify(data) }).then(r => r.json()),
    updateUserBuild: (data: unknown, session: string) => fetch(`${URLS.auth}?action=update_build`, { method: "PUT", headers: authHeaders(session), body: JSON.stringify(data) }).then(r => r.json()),
    deleteUserBuild: (id: number, session: string) => fetch(`${URLS.auth}?action=delete_build`, { method: "DELETE", headers: authHeaders(session), body: JSON.stringify({ id }) }).then(r => r.json()),
    updateProfile: (data: unknown, session: string) => fetch(`${URLS.auth}?action=update_profile`, { method: "POST", headers: authHeaders(session), body: JSON.stringify(data) }).then(r => r.json()),
    viewProfile: (tag: string) => fetch(`${URLS.auth}?action=public&utag=${encodeURIComponent(tag)}`).then(r => r.json()),
    getUserBuild: (token: string) => fetch(`${URLS.auth}?action=user-build&token=${token}`).then(r => r.json()),
    adminLogin: (adminKey: string) => fetch(`${URLS.auth}?action=admin_login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ak: adminKey }) }).then(r => r.json()),
    adminGetUsers: (adminKey: string, search?: string) => fetch(`${URLS.auth}?action=admin_users&ak=${encodeURIComponent(adminKey)}${search ? `&search=${encodeURIComponent(search)}` : ""}`).then(r => r.json()),
    adminUpdateUser: (data: unknown, adminKey: string) => fetch(`${URLS.auth}?action=admin_user_update`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(data as object), ak: adminKey }) }).then(r => r.json()),
  },
  telegramAuth: {
    generateCode: (session: string) => fetch(`${URLS.telegramAuth}?action=generate`, { headers: authHeaders(session) }).then(r => r.json()),
    checkLinked: (session: string) => fetch(`${URLS.telegramAuth}?action=check`, { headers: authHeaders(session) }).then(r => r.json()),
  },
  cables: {
    getAll: () => fetch(URLS.cables).then(r => r.json()),
    getById: (id: number) => fetch(`${URLS.cables}?id=${id}`).then(r => r.json()),
    getByClientToken: (token: string) => fetch(`${URLS.cables}?client_token=${token}`).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.cables, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.cables, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    generateClientLink: (id: number) => fetch(URLS.cables, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate_client_link", id }) }).then(r => r.json()),
    revokeClientLink: (id: number) => fetch(URLS.cables, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke_client_link", id }) }).then(r => r.json()),
    delete: (id: number) => fetch(`${URLS.cables}?id=${id}`, { method: "DELETE" }).then(r => r.json()),
  },
  upload: {
    avatar: (file: string) => fetch(URLS.upload, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, folder: "avatars", compress: true }) }).then(r => r.json()),
  },
  warehouse: {
    getGroups: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams({ action: "groups", ...params }).toString() : "?action=groups"
      return fetch(URLS.warehouse + qs).then(r => r.json())
    },
    getGroup: (id: number) => fetch(`${URLS.warehouse}?action=group_get&id=${id}`).then(r => r.json()),
    getOrderList: () => fetch(`${URLS.warehouse}?action=order_list`).then(r => r.json()),
    createGroup: (data: unknown) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "group_create", ...data as object }) }).then(r => r.json()),
    updateGroup: (data: unknown) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "group_update", ...data as object }) }).then(r => r.json()),
    archiveGroup: (id: number) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "group_archive", id }) }).then(r => r.json()),
    unarchiveGroup: (id: number) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "group_unarchive", id }) }).then(r => r.json()),
    createSupply: (data: unknown) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "supply_create", ...data as object }) }).then(r => r.json()),
    updateSupply: (data: unknown) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "supply_update", ...data as object }) }).then(r => r.json()),
    getStores: () => fetch(`${URLS.warehouse}?action=stores`).then(r => r.json()),
    createStore: (data: unknown) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "store_create", ...data as object }) }).then(r => r.json()),
    updateStore: (data: unknown) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "store_update", ...data as object }) }).then(r => r.json()),
    getMovements: (params?: Record<string, string>) => {
      const qs = new URLSearchParams({ action: "movements", ...params }).toString()
      return fetch(`${URLS.warehouse}?${qs}`).then(r => r.json())
    },
    getCategories: () => fetch(`${URLS.warehouse}?action=categories`).then(r => r.json()),
    renameCategory: (oldName: string, newName: string) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "category_rename", old_name: oldName, new_name: newName }) }).then(r => r.json()),
    deleteCategory: (name: string) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "category_delete", name }) }).then(r => r.json()),
    searchProducts: (q: string) => fetch(`${URLS.warehouse}?action=search_products&q=${encodeURIComponent(q)}`).then(r => r.json()),
    getGroupReserves: (groupId: number) => fetch(`${URLS.warehouse}?action=group_reserves&group_id=${groupId}`).then(r => r.json()),
    reserve: (data: unknown) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reserve", ...data as object }) }).then(r => r.json()),
    writeoff: (data: unknown) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "writeoff", ...data as object }) }).then(r => r.json()),
    inventoryList: () => fetch(`${URLS.warehouse}?action=inventory_list`).then(r => r.json()),
    inventoryCreate: (data: { filter_cells: string[], filter_cats: string[] }) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "inventory_create", ...data }) }).then(r => r.json()),
    inventoryUpdateItem: (data: { item_id: number, qty_actual: number | null, note?: string }) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "inventory_update_item", ...data }) }).then(r => r.json()),
    inventoryApply: (inventory_id: number) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "inventory_apply", inventory_id }) }).then(r => r.json()),
    deleteWip: (wip_id: number) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_wip", wip_id }) }).then(r => r.json()),
    recalcReserves: () => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recalc_reserves" }) }).then(r => r.json()),
    recalcSupplyExpense: () => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recalc_supply_expense" }) }).then(r => r.json()),
    getSettings: () => fetch(`${URLS.warehouse}?action=settings`).then(r => r.json()),
    setSettings: (settings: Record<string, string | number>) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings_set", settings }) }).then(r => r.json()),
    specsList: () => fetch(`${URLS.warehouse}?action=specs_list`).then(r => r.json()),
    specsGet: (productId: number) => fetch(`${URLS.warehouse}?action=specs_get&product_id=${productId}`).then(r => r.json()),
    specsUpdate: (productId: number, specs: Record<string, unknown>) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "specs_update", product_id: productId, specs }) }).then(r => r.json()),
    // Конструктор характеристик совместимости (data-driven)
    specSchema: () => fetch(`${URLS.warehouse}?action=spec_schema`).then(r => r.json()),
    specCatCreate: (data: unknown) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_cat_create", ...data as object }) }).then(r => r.json()),
    specCatUpdate: (data: unknown) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_cat_update", ...data as object }) }).then(r => r.json()),
    specCatDelete: (id: number) => fetch(`${URLS.warehouse}?action=spec_cat_delete&id=${id}`, { method: "DELETE" }).then(r => r.json()),
    specAttrCreate: (data: unknown) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_attr_create", ...data as object }) }).then(r => r.json()),
    specAttrUpdate: (data: unknown) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_attr_update", ...data as object }) }).then(r => r.json()),
    specAttrDelete: (id: number) => fetch(`${URLS.warehouse}?action=spec_attr_delete&id=${id}`, { method: "DELETE" }).then(r => r.json()),
    specLinkCreate: (data: unknown) => fetch(URLS.warehouse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_link_create", ...data as object }) }).then(r => r.json()),
    specLinkUpdate: (data: unknown) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_link_update", ...data as object }) }).then(r => r.json()),
    specLinkDelete: (id: number) => fetch(`${URLS.warehouse}?action=spec_link_delete&id=${id}`, { method: "DELETE" }).then(r => r.json()),
    specProducts: () => fetch(`${URLS.warehouse}?action=spec_products`).then(r => r.json()),
    specValuesGet: (productId: number) => fetch(`${URLS.warehouse}?action=spec_values_get&product_id=${productId}`).then(r => r.json()),
    specValuesSave: (productId: number, values: Record<string, unknown>) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_values_save", product_id: productId, values }) }).then(r => r.json()),
    specSlotProducts: (slot: string) => fetch(`${URLS.warehouse}?action=spec_slot_products&slot=${encodeURIComponent(slot)}`).then(r => r.json()),
    specExportValues: () => fetch(`${URLS.warehouse}?action=spec_export_values`).then(r => r.json()),
    specImport: (items: { product_id: number; values: Record<string, unknown> }[]) => fetch(URLS.warehouse, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_import", items }) }).then(r => r.json()),
  },
  snArchive: {
    list: (params?: Record<string, string>) => {
      const qs = "?" + new URLSearchParams({ action: "list_serials", ...(params || {}) }).toString()
      return fetch(URLS.snArchive + qs).then(r => r.json())
    },
    lookup: (serial: string) => fetch(`${URLS.snArchive}?action=lookup&serial=${encodeURIComponent(serial)}`).then(r => r.json()),
    addSerials: (data: { supply_id: number, serials: string[] }) => fetch(URLS.snArchive, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_serials", ...data }) }).then(r => r.json()),
    supplySerials: (supplyId: number) => fetch(`${URLS.snArchive}?action=supply_serials&supply_id=${supplyId}`).then(r => r.json()),
    updateSerial: (data: unknown) => fetch(URLS.snArchive, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_serial", ...data as object }) }).then(r => r.json()),
    deleteSerial: (id: number) => fetch(URLS.snArchive, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete_serial", id }) }).then(r => r.json()),
    getCategories: () => fetch(`${URLS.snArchive}?action=categories`).then(r => r.json()),
    addCategory: (data: { category: string, require_serial?: boolean }) => fetch(URLS.snArchive, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "category_add", ...data }) }).then(r => r.json()),
    removeCategory: (category: string) => fetch(URLS.snArchive, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "category_remove", category }) }).then(r => r.json()),
    getStores: () => fetch(`${URLS.snArchive}?action=stores`).then(r => r.json()),
  },
  stress: {
    list: (adminKey: string) =>
      fetch(`${URLS.stress}?action=list`, { headers: { "X-Admin-Token": adminKey } }).then(r => r.json()),
    get: (id: number, adminKey: string) =>
      fetch(`${URLS.stress}?action=get&id=${id}`, { headers: { "X-Admin-Token": adminKey } }).then(r => r.json()),
    deleteRun: (id: number, adminKey: string) =>
      fetch(`${URLS.stress}?action=delete_run&id=${id}`, { method: "DELETE", headers: { "X-Admin-Token": adminKey } }).then(r => r.json()),
    profilesList: (adminKey: string) =>
      fetch(`${URLS.stress}?action=profiles_list`, { headers: { "X-Admin-Token": adminKey } }).then(r => r.json()),
    profileSave: (data: unknown, adminKey: string) =>
      fetch(`${URLS.stress}?action=profile_save`, { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": adminKey }, body: JSON.stringify({ action: "profile_save", ...(data as object) }) }).then(r => r.json()),
    profileDelete: (id: number, adminKey: string) =>
      fetch(`${URLS.stress}?action=profile_delete&id=${id}`, { method: "DELETE", headers: { "X-Admin-Token": adminKey } }).then(r => r.json()),
    metricPrefsList: (adminKey: string) =>
      fetch(`${URLS.stress}?action=metric_prefs_list`, { headers: { "X-Admin-Token": adminKey } }).then(r => r.json()),
    metricPrefsSave: (prefs: unknown, adminKey: string) =>
      fetch(`${URLS.stress}?action=metric_prefs_save`, { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": adminKey }, body: JSON.stringify({ action: "metric_prefs_save", prefs }) }).then(r => r.json()),
    presetsList: (adminKey: string) =>
      fetch(`${URLS.stress}?action=presets_list`, { headers: { "X-Admin-Token": adminKey } }).then(r => r.json()),
    presetSave: (data: unknown, adminKey: string) =>
      fetch(`${URLS.stress}?action=preset_save`, { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": adminKey }, body: JSON.stringify({ action: "preset_save", ...(data as object) }) }).then(r => r.json()),
    presetDelete: (id: number, adminKey: string) =>
      fetch(`${URLS.stress}?action=preset_delete&id=${id}`, { method: "DELETE", headers: { "X-Admin-Token": adminKey } }).then(r => r.json()),
  },
  finance: {
    getSummary: () => fetch(`${URLS.finance}?action=summary`).then(r => r.json()),
    getLog: (limit = 200, offset = 0, dateFrom?: string, dateTo?: string) => {
      let url = `${URLS.finance}?action=log&limit=${limit}&offset=${offset}`
      if (dateFrom) url += `&date_from=${dateFrom}`
      if (dateTo) url += `&date_to=${dateTo}`
      return fetch(url).then(r => r.json())
    },
    getTypes: () => fetch(`${URLS.finance}?action=types`).then(r => r.json()),
    syncSupplyExpense: () => fetch(`${URLS.finance}?action=sync_supply_expense`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync_supply_expense" }) }).then(r => r.json()),
    addTx: (data: { kind: string; amount: number; type_id?: number | null; note?: string; user_id?: number | null }) =>
      fetch(`${URLS.finance}?action=add_tx`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    delTx: (id: number) => fetch(`${URLS.finance}?action=del_tx&id=${id}`, { method: "DELETE" }).then(r => r.json()),
    addType: (data: { name: string; direction: string }) =>
      fetch(`${URLS.finance}?action=add_type`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    delType: (id: number) => fetch(`${URLS.finance}?action=del_type&id=${id}`, { method: "DELETE" }).then(r => r.json()),
    getAccounts: () => fetch(`${URLS.finance}?action=accounts`).then(r => r.json()),
    getAccountLog: (employeeId: number) => fetch(`${URLS.finance}?action=account_log&employee_id=${employeeId}`).then(r => r.json()),
    creditAccount: (data: { employee_id: number; amount: number; note?: string }) =>
      fetch(`${URLS.finance}?action=credit_account`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    getCashAccounts: () => fetch(`${URLS.finance}?action=cash_accounts`).then(r => r.json()),
    getCashAccountLog: (cashAccountId: number) => fetch(`${URLS.finance}?action=cash_account_log&cash_account_id=${cashAccountId}`).then(r => r.json()),
    confirmPrepayment: (data: { order_id: number; amount: number; employee_id?: number | null; cash_account_id?: number | null }) =>
      fetch(`${URLS.finance}?action=confirm_prepayment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    confirmRemaining: (data: { order_id: number; amount: number; employee_id?: number | null; cash_account_id?: number | null }) =>
      fetch(`${URLS.finance}?action=confirm_remaining`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  },
  comments: {
    getByToken: (token: string) => fetch(`${URLS.comments}?token=${token}`).then(r => r.json()),
    getByArticle: (articleId: number) => fetch(`${URLS.comments}?article_id=${articleId}`).then(r => r.json()),
    add: (data: { token?: string; article_id?: number; text: string; parent_id?: number }, session: string) =>
      fetch(`${URLS.comments}?action=add`, { method: "POST", headers: authHeaders(session), body: JSON.stringify(data) }).then(r => r.json()),
    delete: (id: number, session: string) =>
      fetch(`${URLS.comments}?action=delete`, { method: "POST", headers: authHeaders(session), body: JSON.stringify({ id }) }).then(r => r.json()),
  },
  notifications: {
    getAll: (session: string) => fetch(URLS.notifications, { headers: authHeaders(session) }).then(r => r.json()),
    markRead: (id: number, session: string) =>
      fetch(`${URLS.notifications}?action=read`, { method: "POST", headers: authHeaders(session), body: JSON.stringify({ id }) }).then(r => r.json()),
    markAllRead: (session: string) =>
      fetch(`${URLS.notifications}?action=read_all`, { method: "POST", headers: authHeaders(session) }).then(r => r.json()),
  },
  rma: {
    list: (status?: string) => fetch(`${URLS.rma}?action=list${status ? `&status=${status}` : ""}`).then(r => r.json()),
    get: (id: number) => fetch(`${URLS.rma}?action=get&id=${id}`).then(r => r.json()),
    stats: () => fetch(`${URLS.rma}?action=stats`).then(r => r.json()),
    orderComponents: (orderId: number) => fetch(`${URLS.rma}?action=order_components&order_id=${orderId}`).then(r => r.json()),
    stockQty: (groupId: number) => fetch(`${URLS.rma}?action=stock_qty&group_id=${groupId}`).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.rma, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", ...data as object }) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.rma, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", ...data as object }) }).then(r => r.json()),
    resolveReplacement: (data: unknown) => fetch(URLS.rma, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve_replacement", ...data as object }) }).then(r => r.json()),
    resolveRefund: (data: unknown) => fetch(URLS.rma, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve_refund", ...data as object }) }).then(r => r.json()),
  },
}