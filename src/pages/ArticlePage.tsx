import { useEffect, useRef, useState } from "react"
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
  return text
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/(.+)/s, "<p>$1</p>")
}

// HTML-iframe с автоподгонкой высоты по содержимому
function Autoiframe({ html, fullscreen = false }: { html: string; fullscreen?: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(400)

  // Инжектим скрипт авторесайза прямо в html
  const wrappedHtml = html.replace(
    /<\/body>/i,
    `<script>
      function _sendHeight() {
        var h = document.documentElement.scrollHeight || document.body.scrollHeight;
        window.parent.postMessage({ type: 'iframe-height', height: h }, '*');
      }
      window.addEventListener('load', _sendHeight);
      new MutationObserver(_sendHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
      _sendHeight();
    </script></body>`
  )

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "iframe-height" && typeof e.data.height === "number") {
        setHeight(Math.max(200, e.data.height + 32))
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={wrappedHtml}
      sandbox="allow-scripts allow-same-origin"
      className="w-full border-0"
      style={{ height: fullscreen ? "100%" : height }}
      title="HTML вложение"
    />
  )
}

// Полноэкранный оверлей
function HtmlFullscreen({ html, onClose }: { html: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" style={{ cursor: "auto" }}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0">
        <span className="text-sm font-medium text-foreground">Результаты теста</span>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-all"
          style={{ cursor: "pointer" }}
        >
          <Icon name="X" size={13} /> Закрыть
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <iframe
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin"
          className="w-full border-0"
          style={{ height: "100%", minHeight: "100%" }}
          title="HTML вложение полноэкранный"
        />
      </div>
    </div>
  )
}

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [fullscreen, setFullscreen] = useState(false)

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
      {fullscreen && article.html_attachment && (
        <HtmlFullscreen html={article.html_attachment} onClose={() => setFullscreen(false)} />
      )}

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
              <p className="text-base leading-relaxed text-muted-foreground">{article.excerpt}</p>
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
              className="prose prose-sm sm:prose max-w-none text-foreground
                prose-headings:font-light prose-headings:text-foreground
                prose-p:text-foreground/80 prose-p:leading-relaxed
                prose-strong:text-foreground prose-strong:font-semibold
                prose-em:text-foreground/70
                prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:text-foreground prose-code:font-mono
                prose-ul:text-foreground/80 prose-li:marker:text-primary
                prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(article.content) }}
            />
          )}

          {/* HTML-вложение — iframe с авто-высотой */}
          {article.html_attachment && (
            <div className="mt-10">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Icon name="BarChart2" size={15} className="text-primary" />
                  Результаты теста
                </div>
                <button
                  onClick={() => setFullscreen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-all"
                  style={{ cursor: "pointer" }}
                >
                  <Icon name="Maximize2" size={12} />
                  Подробнее
                </button>
              </div>
              <div className="w-full overflow-hidden rounded-xl border border-border">
                <Autoiframe html={article.html_attachment} />
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  )
}