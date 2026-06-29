import { Helmet } from "react-helmet-async"

export const SITE_URL = "https://begraphics.ru"
export const SITE_NAME = "BeGraphics"
const DEFAULT_DESC = "Ремонт и продажа комплектующих, профессиональная сборка, настройка и диагностика ПК."
const DEFAULT_IMAGE = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/favicon-1778432755367.png"

interface SeoProps {
  title?: string
  description?: string | null
  image?: string | null
  /** Путь страницы для canonical, напр. "/articles/12". По умолчанию текущий путь. */
  path?: string
  /** og:type — website | article | product */
  type?: "website" | "article" | "product"
  /** Запретить индексацию (служебные/приватные страницы). */
  noindex?: boolean
  /** Schema.org JSON-LD — объект или массив объектов. */
  jsonLd?: object | object[]
}

/** Снимает HTML-теги и схлопывает пробелы — для description из rich-контента. */
function stripHtml(s: string, max = 200): string {
  const text = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text
}

/**
 * Динамические SEO-теги для страницы: title, description, canonical,
 * Open Graph, Twitter Card и микроразметка Schema.org (JSON-LD).
 * Яндекс и Google исполняют JS и считывают эти теги при индексации.
 */
export default function Seo({ title, description, image, path, type = "website", noindex, jsonLd }: SeoProps) {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME
  const desc = stripHtml(description || DEFAULT_DESC)
  const img = image || DEFAULT_IMAGE
  const canonical = SITE_URL + (path ?? (typeof window !== "undefined" ? window.location.pathname : "/"))

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={canonical} />
      {noindex
        ? <meta name="robots" content="noindex, nofollow" />
        : <meta name="robots" content="index, follow" />}

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="ru_RU" />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={img} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={img} />

      {jsonLd && (
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      )}
    </Helmet>
  )
}
