import { useState, useEffect, useRef } from "react"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"

interface Comment {
  id: number
  parent_id: number | null
  text: string
  created_at: string
  user_id: number
  username: string
  avatar_url: string
}

function timeAgo(iso: string) {
  const mskOffset = 3 * 60 * 60 * 1000
  const date = new Date(new Date(iso).getTime() + mskOffset)
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return "только что"
  if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч. назад`
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" })
}

interface Props {
  buildToken?: string
  articleId?: number
  highlightId?: number | null
}

export default function CommentSection({ buildToken, articleId, highlightId }: Props) {
  const { isAuthed, sessionId, user } = useAuth()
  const navigate = useNavigate()
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState("")
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [sending, setSending] = useState(false)
  const highlightRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const fetch = articleId
      ? api.comments.getByArticle(articleId)
      : api.comments.getByToken(buildToken!)
    fetch.then(d => {
      setComments(d.comments || [])
      setLoading(false)
    })
  }, [buildToken, articleId])

  useEffect(() => {
    if (highlightId && highlightRef.current) {
      setTimeout(() => highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300)
    }
  }, [highlightId, comments.length])

  const send = async () => {
    if (!text.trim() || !sessionId) return
    setSending(true)
    const payload = articleId
      ? { article_id: articleId, text: text.trim(), parent_id: replyTo?.id }
      : { token: buildToken!, text: text.trim(), parent_id: replyTo?.id }
    const res = await api.comments.add(payload, sessionId)
    if (res.id) {
      setComments(prev => [...prev, res])
      setText("")
      setReplyTo(null)
    }
    setSending(false)
  }

  const deleteComment = async (id: number) => {
    if (!sessionId) return
    await api.comments.delete(id, sessionId)
    setComments(prev => prev.map(c => c.id === id ? { ...c, text: "[удалено]" } : c))
  }

  // Строим дерево: top-level + ответы
  const topLevel = comments.filter(c => !c.parent_id)
  const replies = (parentId: number) => comments.filter(c => c.parent_id === parentId)

  function Avatar({ c }: { c: Comment }) {
    return c.avatar_url
      ? <img src={c.avatar_url} alt={c.username} className="h-8 w-8 rounded-full object-cover shrink-0" />
      : <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0">{c.username[0]?.toUpperCase()}</div>
  }

  function CommentItem({ c, isReply = false }: { c: Comment; isReply?: boolean }) {
    const isHighlighted = c.id === highlightId
    const isDeleted = c.text === "[удалено]"
    return (
      <div
        id={`comment-${c.id}`}
        ref={isHighlighted ? highlightRef : undefined}
        className={`flex gap-3 ${isReply ? "ml-10" : ""} ${isHighlighted ? "rounded-xl bg-primary/8 ring-1 ring-primary/30 px-3 py-2 -mx-3" : ""}`}
      >
        <Avatar c={c} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-medium text-foreground">{c.username}</span>
            <span className="text-xs text-foreground/40">{timeAgo(c.created_at)}</span>
          </div>
          <p className={`text-sm leading-relaxed ${isDeleted ? "text-foreground/30 italic" : "text-foreground/80"}`}>
            {c.text}
          </p>
          {!isDeleted && (
            <div className="mt-1.5 flex items-center gap-3">
              {isAuthed() && (
                <button
                  onClick={() => { setReplyTo(c); textareaRef.current?.focus() }}
                  className="text-xs text-foreground/40 hover:text-primary transition-colors"
                  style={{ cursor: "pointer" }}
                >
                  Ответить
                </button>
              )}
              {user && (user.id === c.user_id || user.role === "admin") && (
                <button
                  onClick={() => deleteComment(c.id)}
                  className="text-xs text-foreground/30 hover:text-red-400 transition-colors"
                  style={{ cursor: "pointer" }}
                >
                  Удалить
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 border-t border-border/60 pt-6">
      <h3 className="mb-4 text-sm font-semibold text-foreground flex items-center gap-2">
        <Icon name="MessageSquare" size={16} className="text-primary" />
        Комментарии
        {comments.length > 0 && <span className="text-xs text-foreground/40 font-normal">{comments.length}</span>}
      </h3>

      {/* Форма */}
      {isAuthed() ? (
        <div className="mb-5 space-y-2">
          {replyTo && (
            <div className="flex items-center gap-2 rounded-lg bg-primary/8 border border-primary/20 px-3 py-2">
              <Icon name="CornerDownRight" size={13} className="text-primary shrink-0" />
              <span className="text-xs text-foreground/60 truncate">Ответ для <span className="font-medium text-foreground">{replyTo.username}</span></span>
              <button onClick={() => setReplyTo(null)} className="ml-auto text-foreground/30 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="X" size={12} />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send() }}
              placeholder="Написать комментарий..."
              rows={2}
              className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none resize-none transition-colors"
              style={{ cursor: "text" }}
            />
            <button
              onClick={send}
              disabled={!text.trim() || sending}
              className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              style={{ cursor: text.trim() ? "pointer" : "not-allowed" }}
            >
              <Icon name={sending ? "Loader" : "Send"} size={16} />
            </button>
          </div>
          <p className="text-xs text-foreground/30">Ctrl+Enter для отправки</p>
        </div>
      ) : (
        <button
          onClick={() => navigate("/auth")}
          className="mb-5 flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-foreground/50 hover:border-primary hover:text-foreground transition-colors w-full"
          style={{ cursor: "pointer" }}
        >
          <Icon name="LogIn" size={15} />
          Войдите, чтобы оставить комментарий
        </button>
      )}

      {/* Список */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-muted/40 animate-pulse" />)}
        </div>
      ) : topLevel.length === 0 ? (
        <p className="text-sm text-foreground/30 text-center py-4">Комментариев пока нет — будь первым!</p>
      ) : (
        <div className="space-y-5">
          {topLevel.map(c => (
            <div key={c.id} className="space-y-3">
              <CommentItem c={c} />
              {replies(c.id).map(r => <CommentItem key={r.id} c={r} isReply />)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}