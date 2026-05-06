import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface CartItem {
  id: number
  name: string
  price: number
  quantity: number
  image_url?: string | null
  type: "product" | "config"
  assembly?: boolean
}

interface CartStore {
  items: CartItem[]
  addItem: (item: Omit<CartItem, "quantity">) => void
  removeItem: (id: number) => void
  updateQty: (id: number, qty: number) => void
  clearCart: () => void
  total: () => number
  count: () => number
  getItemQty: (id: number, type: "product" | "config") => number
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) => {
        const existing = get().items.find(i => i.id === item.id && i.type === item.type)
        if (existing) {
          set(s => ({ items: s.items.map(i => i.id === item.id && i.type === item.type ? { ...i, quantity: i.quantity + 1 } : i) }))
        } else {
          set(s => ({ items: [...s.items, { ...item, quantity: 1 }] }))
        }
      },
      removeItem: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),
      updateQty: (id, qty) => {
        if (qty <= 0) {
          set(s => ({ items: s.items.filter(i => i.id !== id) }))
        } else {
          set(s => ({ items: s.items.map(i => i.id === id ? { ...i, quantity: qty } : i) }))
        }
      },
      clearCart: () => set({ items: [] }),
      total: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      count: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
      getItemQty: (id, type) => get().items.find(i => i.id === id && i.type === type)?.quantity ?? 0,
    }),
    { name: "begraphics-cart" }
  )
)