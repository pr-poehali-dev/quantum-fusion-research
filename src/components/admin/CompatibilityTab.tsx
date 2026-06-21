import { useState, useEffect, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { SpecSchema } from "./compatibility/types"
import AttributesBuilder from "./compatibility/AttributesBuilder"
import ProductsValues from "./compatibility/ProductsValues"
import LinksMap from "./compatibility/LinksMap"

type SubTab = "products" | "attributes" | "links"

const SUBTABS: { key: SubTab; label: string; icon: string }[] = [
  { key: "products", label: "Железки", icon: "PackageSearch" },
  { key: "attributes", label: "Характеристики", icon: "SlidersHorizontal" },
  { key: "links", label: "Карта связей", icon: "Network" },
]

const EMPTY: SpecSchema = { categories: [], attributes: [], links: [] }

export default function CompatibilityTab() {
  const [sub, setSub] = useState<SubTab>("products")
  const [schema, setSchema] = useState<SpecSchema>(EMPTY)
  const [prodCats, setProdCats] = useState<{ slug: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  const loadSchema = useCallback(() => {
    return api.warehouse.specSchema().then((d: SpecSchema) => {
      setSchema({ categories: d.categories || [], attributes: d.attributes || [], links: d.links || [] })
    })
  }, [])

  useEffect(() => {
    Promise.all([
      loadSchema(),
      api.products.getAll().then((d: { categories?: { slug: string; name: string }[] }) =>
        setProdCats(d.categories || [])),
    ]).finally(() => setLoading(false))
  }, [loadSchema])

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-foreground">Совместимость комплектующих</h2>
        <p className="mt-1 text-sm text-foreground/50">
          Конструктор характеристик для умного конфигуратора. Настраивайте категории и поля,
          заполняйте железки, связывайте характеристики в карте совместимости.
        </p>
      </div>

      {/* Подвкладки */}
      <div className="mb-6 flex gap-1 rounded-lg border border-border bg-card p-1">
        {SUBTABS.map(t => (
          <button key={t.key} onClick={() => setSub(t.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${sub === t.key ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>
            <Icon name={t.icon as "Network"} size={16} fallback="Circle" />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 text-center text-foreground/40">Загрузка...</div>
      ) : (
        <>
          {sub === "products" && <ProductsValues schema={schema} />}
          {sub === "attributes" && <AttributesBuilder schema={schema} productCategorySlugs={prodCats} reload={loadSchema} />}
          {sub === "links" && <LinksMap schema={schema} reload={loadSchema} />}
        </>
      )}
    </div>
  )
}
