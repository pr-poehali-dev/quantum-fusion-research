import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { useCart } from "@/store/cart"

interface Product {
  id: number
  name: string
  description: string
  price: number
  old_price: number | null
  image_url: string | null
  image_urls?: string[]
  specs: Record<string, string>
  in_stock: boolean
  is_featured: boolean
  category: { id: number; name: string; slug: string } | null
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [imgIdx, setImgIdx] = useState(0)
  const { addItem, items, updateQty } = useCart()

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  useEffect(() => {
    if (!id) return
    api.products.getById(Number(id))
      .then(data => { setProduct(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )

  if (!product) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <Icon name="PackageX" size={48} className="mb-4 text-muted-foreground/30" />
      <h1 className="mb-2 text-xl font-medium text-foreground">Товар не найден</h1>
      <button onClick={() => navigate("/shop")} className="mt-5 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        В каталог
      </button>
    </div>
  )

  const images = product.image_urls?.length ? product.image_urls : product.image_url ? [product.image_url] : []
  const cartItem = items.find(i => i.id === product.id && i.type === "product")
  const cartQty = cartItem?.quantity ?? 0

  const handleAddToCart = () => {
    addItem({ id: product.id, name: product.name, price: product.price, image_url: product.image_url, type: "product" })
  }

  const discount = product.old_price ? Math.round((1 - product.price / product.old_price) * 100) : null

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Хедер */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={15} />
            Назад
          </button>
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">B</div>
            <span className="hidden sm:block text-sm font-medium text-foreground/70">BeGraphics</span>
          </button>
          <button onClick={() => navigate("/cart")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ShoppingCart" size={15} />
            Корзина
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
        {/* Хлебные крошки */}
        <nav className="mb-6 flex items-center gap-2 text-xs text-foreground/40">
          <button onClick={() => navigate("/shop")} className="hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Каталог</button>
          {product.category && <>
            <span>/</span>
            <span>{product.category.name}</span>
          </>}
          <span>/</span>
          <span className="text-foreground/70 truncate max-w-[200px]">{product.name}</span>
        </nav>

        {/* Основной блок — фото слева, инфо справа */}
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-16 mb-12">
          {/* Левая часть — галерея */}
          <div className="space-y-3">
            <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted">
              {images.length > 0 ? (
                <img src={images[imgIdx]} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Icon name="Monitor" size={64} className="text-foreground/15" />
                </div>
              )}
              {discount && (
                <span className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                  -{discount}%
                </span>
              )}
              {!product.in_stock && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm rounded-2xl">
                  <span className="rounded-xl border border-foreground/20 bg-background/80 px-5 py-2 text-sm font-semibold uppercase tracking-widest text-foreground/60">
                    Нет в наличии
                  </span>
                </div>
              )}
              {/* Стрелки навигации */}
              {images.length > 1 && (
                <>
                  <button onClick={() => setImgIdx(i => (i - 1 + images.length) % images.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 border border-border/50 hover:border-primary transition-colors backdrop-blur"
                    style={{ cursor: "pointer" }}>
                    <Icon name="ChevronLeft" size={16} />
                  </button>
                  <button onClick={() => setImgIdx(i => (i + 1) % images.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 border border-border/50 hover:border-primary transition-colors backdrop-blur"
                    style={{ cursor: "pointer" }}>
                    <Icon name="ChevronRight" size={16} />
                  </button>
                </>
              )}
            </div>
            {/* Миниатюры */}
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {images.map((src, i) => (
                  <button key={i} onClick={() => setImgIdx(i)}
                    className={`shrink-0 h-16 w-16 overflow-hidden rounded-lg border-2 transition-colors ${i === imgIdx ? "border-primary" : "border-border hover:border-primary/50"}`}
                    style={{ cursor: "pointer" }}>
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Правая часть — инфо */}
          <div className="flex flex-col">
            {product.category && (
              <span className="mb-2 text-xs font-mono text-foreground/40 uppercase tracking-wider">{product.category.name}</span>
            )}
            <h1 className="mb-4 text-2xl sm:text-3xl font-light leading-tight text-foreground">{product.name}</h1>

            {/* Цена */}
            <div className="mb-6 flex items-end gap-3">
              <span className="text-3xl font-bold text-foreground">{fmt(product.price)}</span>
              {product.old_price && (
                <span className="mb-1 text-base text-foreground/40 line-through">{fmt(product.old_price)}</span>
              )}
            </div>

            {/* Наличие */}
            <div className="mb-6 flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${product.in_stock ? "bg-green-400" : "bg-foreground/30"}`} />
              <span className="text-sm text-foreground/60">{product.in_stock ? "В наличии" : "Нет в наличии"}</span>
            </div>

            {/* Кнопки */}
            <div className="flex flex-wrap gap-3 mb-8">
              {cartQty > 0 ? (
                <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                  <button onClick={() => updateQty(product.id, cartQty - 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border hover:border-primary transition-colors"
                    style={{ cursor: "pointer" }}>
                    <Icon name="Minus" size={13} />
                  </button>
                  <span className="min-w-[3rem] text-center font-bold text-foreground">{cartQty} шт</span>
                  <button onClick={handleAddToCart}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border hover:border-primary transition-colors"
                    style={{ cursor: "pointer" }}>
                    <Icon name="Plus" size={13} />
                  </button>
                  <span className="ml-2 text-sm font-medium text-green-400">В корзине</span>
                </div>
              ) : (
                <button onClick={handleAddToCart} disabled={!product.in_stock}
                  className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                  style={{ cursor: product.in_stock ? "pointer" : "not-allowed" }}>
                  <Icon name="ShoppingCart" size={16} />
                  В корзину
                </button>
              )}
              <button onClick={() => navigate("/cart")}
                className="flex items-center gap-2 rounded-xl border border-border px-6 py-3 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors"
                style={{ cursor: "pointer" }}>
                Перейти в корзину
              </button>
            </div>

            {/* Краткие характеристики */}
            {Object.keys(product.specs).length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 text-xs font-mono text-foreground/40 uppercase tracking-wider">Характеристики</h3>
                <div className="space-y-2">
                  {Object.entries(product.specs).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-4 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                      <span className="text-sm text-foreground/50 capitalize">{k}</span>
                      <span className="text-sm font-medium text-foreground text-right">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Описание */}
        {product.description && (
          <div className="border-t border-border pt-10">
            <h2 className="mb-5 text-xl font-light text-foreground">Описание</h2>
            <div className="max-w-3xl rich-content text-foreground/70 leading-relaxed text-base"
              dangerouslySetInnerHTML={{ __html: product.description }} />
          </div>
        )}
      </main>
    </div>
  )
}