import React, { useState } from "react"
import { api } from "@/lib/api"
import { CableBody } from "@/components/cable-configurator"
import {
  Product, Category, ConfigComponent, Tag, PCBuild, Article, AdminTab,
} from "@/pages/admin/types"
import { TagsSection } from "./catalog/TagsSection"
import { ArticlesSection } from "./catalog/ArticlesSection"
import { ProductsSection } from "./catalog/ProductsSection"
import { BuildsSection } from "./catalog/BuildsSection"

interface Props {
  tab: AdminTab
  setTab: (t: AdminTab) => void
  loading: boolean
  // Products
  products: Product[]
  categories: Category[]
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>
  // Builds
  builds: PCBuild[]
  setBuilds: React.Dispatch<React.SetStateAction<PCBuild[]>>
  configSlots: Record<string, ConfigComponent[]>
  setConfigSlots: React.Dispatch<React.SetStateAction<Record<string, ConfigComponent[]>>>
  tags: Tag[]
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>
  // Articles
  articles: Article[]
  setArticles: React.Dispatch<React.SetStateAction<Article[]>>
  // авто-открытие сборки на редактирование (из WIP)
  autoEditBuildId?: number | null
  clearAutoEditBuildId?: () => void
  // авто-открытие статьи на редактирование (переживает remount поддерева)
  autoEditArticleId?: number | null
  setAutoEditArticleId?: (id: number | null) => void
}

export function AdminCatalogTab({
  tab, setTab, loading,
  products, categories, setProducts, setCategories,
  builds, setBuilds, configSlots,
  tags, setTags,
  articles, setArticles,
  autoEditBuildId, clearAutoEditBuildId,
  autoEditArticleId, setAutoEditArticleId,
}: Props) {
  // ── Products вынесены в ./catalog/ProductsSection.tsx ───────────────────────
  // ── Builds вынесены в ./catalog/BuildsSection.tsx ───────────────────────────
  // ── Tags вынесены в ./catalog/TagsSection.tsx ───────────────────────────────

  // ── Articles вынесены в ./catalog/ArticlesSection.tsx ───────────────────────

  // ── Cables ────────────────────────────────────────────────────────────────
  const [cableAdded, setCableAdded] = useState(false)

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // PRODUCTS — вынесено в ./catalog/ProductsSection.tsx
  if (tab === "products" || tab === "add_product")
    return <ProductsSection tab={tab} setTab={setTab} loading={loading} products={products} setProducts={setProducts} categories={categories} setCategories={setCategories} />

  // BUILDS — вынесено в ./catalog/BuildsSection.tsx
  if (tab === "builds" || tab === "archive" || tab === "add_build")
    return <BuildsSection tab={tab} setTab={setTab} loading={loading}
      builds={builds} setBuilds={setBuilds} configSlots={configSlots} categories={categories} tags={tags}
      autoEditBuildId={autoEditBuildId} clearAutoEditBuildId={clearAutoEditBuildId} />

  // CABLES
  if (tab === "cables") {
    const handleCableAdd = async (name: string, _summary: string, pinColors: Record<string, string>, cpuType: string, gpuType: string) => {
      try { await api.cables.create({ name, cpu_type: cpuType, gpu_type: gpuType, pin_colors: pinColors }) } catch { /* ignore */ }
      setCableAdded(true)
      setTimeout(() => setCableAdded(false), 3000)
    }
    return (
      <div>
        <h2 className="mb-6 text-xl font-light text-foreground">Кастомные кабели</h2>
        <CableBody addToCart={handleCableAdd} added={cableAdded} />
      </div>
    )
  }

  // TAGS
  if (tab === "tags") return <TagsSection tags={tags} setTags={setTags} loading={loading} />

  // ARTICLES — вынесено в ./catalog/ArticlesSection.tsx
  if (tab === "articles" || tab === "add_article")
    return <ArticlesSection tab={tab} setTab={setTab} loading={loading} articles={articles} setArticles={setArticles}
      autoEditArticleId={autoEditArticleId} setAutoEditArticleId={setAutoEditArticleId} />

  return null
}