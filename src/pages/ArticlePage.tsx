import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  category: string
  content: string
  html_attachment: string | null
  views: number
  created_at: string
}

const CATEGORY_LABELS: Record<string, string> = {
  article: "Статья",
  review: "Обзор",
  test: "Тест / Бенчмарк",
  guide: "Гайд",
}

function renderMarkdown(text: string): string {
  // Разбиваем по двойному переносу — это параграфы
  const paragraphs = text.split(/\n{2,}/)

  const processLine = (line: string) =>
    line
      .replace(/^### (.+)$/, "<h3>$1</h3>")
      .replace(/^## (.+)$/, "<h2>$1</h2>")
      .replace(/^# (.+)$/, "<h1>$1</h1>")
      .replace(/^- (.+)$/, "<li>$1</li>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")

  return paragraphs.map(para => {
    const lines = para.split("\n").map(processLine)
    const content = lines.join("<br/>")
    // Не оборачиваем в <p> если уже есть блочный тег
    if (/^<(h[1-3]|ul|li|blockquote)/.test(content)) return content
    return `<p>${content}</p>`
  }).join("\n")
}

// Открывает HTML-вложение в новой вкладке через Blob URL
function openHtmlInNewTab(html: string) {
  const blob = new Blob([html], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank")
  // Освобождаем URL через небольшую задержку
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!id) { setError("Статья не найдена"); setLoading(false); return }
    api.articles.getById(Number(id))
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setArticle(data)
        setLoading(false)
      })
      .catch(() => { setError("Не удалось загрузить статью"); setLoading(false) })
  }, [id])

  const fmt = (date: string) =>
    new Date(date).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )

  if (error || !article) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <Icon name="FileX" size={48} className="mb-4 text-muted-foreground/30" />
      <h1 className="mb-2 text-xl font-medium text-foreground">{error || "Статья не найдена"}</h1>
      <button onClick={() => navigate("/")} className="mt-5 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        На главную
      </button>
    </div>
  )

  return (
    <>
      <div className="min-h-screen bg-background text-foreground">
        {/* Хедер */}
        <header className="sticky top-0 z-40 border-b border-border/50 bg-background/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="ArrowLeft" size={15} />
              Назад
            </button>
            <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">B</div>
              <span className="hidden sm:block text-sm font-medium text-foreground/70">BeGraphics</span>
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
          {/* Мета */}
          <div className="mb-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {CATEGORY_LABELS[article.category] || article.category}
              </span>
              <span className="text-xs text-muted-foreground">{fmt(article.created_at)}</span>
            </div>
            <h1 className="mb-4 text-3xl sm:text-4xl font-light leading-tight text-foreground">{article.title}</h1>
            {article.excerpt && (
              <div className="text-base leading-relaxed text-muted-foreground rich-content" dangerouslySetInnerHTML={{ __html: article.excerpt }} />
            )}
          </div>

          {/* Обложка */}
          {article.image_url && (
            <div className="mb-8 overflow-hidden rounded-2xl border border-border">
              <img src={article.image_url} alt={article.title} className="w-full object-contain" style={{ maxHeight: "50vh" }} />
            </div>
          )}

          {/* Контент */}
          {article.content && (
            <div
              className="rich-content text-foreground/80 leading-relaxed text-base"
              dangerouslySetInnerHTML={{ __html: article.content }}
            />
          )}

          {/* HTML-вложение — кнопка открытия в новой вкладке */}
          {article.html_attachment && (
            <div className="mt-10">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon name="FileCode2" size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">HTML-вложение</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Интерактивные результаты теста или бенчмарк</p>
                </div>
                <button
                  onClick={() => openHtmlInNewTab(article.html_attachment!)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  style={{ cursor: "pointer" }}
                >
                  <Icon name="ExternalLink" size={13} />
                  Посмотреть вложение
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  )
}