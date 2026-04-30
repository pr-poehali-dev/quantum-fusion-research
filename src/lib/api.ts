const URLS = {
  products: "https://functions.poehali.dev/ab453741-d994-4115-9a77-276036d19dbd",
  orders: "https://functions.poehali.dev/92fb1cdd-4b87-4bcb-8154-75a499dd1745",
  configurator: "https://functions.poehali.dev/a844a2c2-9cb6-4144-a1d9-51477c02c750",
}

export const api = {
  products: {
    getAll: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : ""
      return fetch(URLS.products + qs).then(r => r.json())
    },
    getById: (id: number) => fetch(`${URLS.products}/${id}`).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.products, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.products, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    patch: (data: unknown) => fetch(URLS.products, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  },
  configurator: {
    getSlots: () => fetch(URLS.configurator).then(r => r.json()),
    create: (data: unknown) => fetch(URLS.configurator, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    update: (data: unknown) => fetch(URLS.configurator, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  },
  orders: {
    create: (data: unknown) => fetch(URLS.orders, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    getAll: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : ""
      return fetch(URLS.orders + qs).then(r => r.json())
    },
    updateStatus: (data: unknown) => fetch(URLS.orders, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  },
}
