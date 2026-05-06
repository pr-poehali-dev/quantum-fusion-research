import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import { useEffect, useCallback } from "react"
import Icon from "@/components/ui/icon"

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export default function RichTextEditor({ value, onChange, placeholder, className }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline cursor-pointer" } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "outline-none min-h-[120px] prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-a:text-primary",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML())
    },
  })

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, false)
    }
  }, [value, editor])

  const setLink = useCallback(() => {
    if (!editor) return
    const prev = editor.getAttributes("link").href
    const url = window.prompt("Ссылка:", prev)
    if (url === null) return
    if (url === "") { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
  }, [editor])

  if (!editor) return null

  const btn = (active: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded transition-colors ${active ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:bg-muted hover:text-foreground"}`

  return (
    <div className={`rounded-lg border border-border bg-background focus-within:border-primary transition-colors ${className ?? ""}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive("bold"))} title="Жирный">
          <Icon name="Bold" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive("italic"))} title="Курсив">
          <Icon name="Italic" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive("underline"))} title="Подчёркнутый">
          <Icon name="Underline" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={btn(editor.isActive("strike"))} title="Зачёркнутый">
          <Icon name="Strikethrough" size={13} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive("heading", { level: 2 }))} title="Заголовок">
          <Icon name="Heading2" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive("bulletList"))} title="Список">
          <Icon name="List" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive("orderedList"))} title="Нумерованный список">
          <Icon name="ListOrdered" size={13} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button type="button" onClick={setLink} className={btn(editor.isActive("link"))} title="Ссылка">
          <Icon name="Link" size={13} />
        </button>
        {editor.isActive("link") && (
          <button type="button" onClick={() => editor.chain().focus().unsetLink().run()} className={btn(false)} title="Убрать ссылку">
            <Icon name="LinkOff" size={13} />
          </button>
        )}

        <div className="mx-1 h-5 w-px bg-border" />

        <button type="button" onClick={() => editor.chain().focus().undo().run()} className={btn(false)} title="Отменить" disabled={!editor.can().undo()}>
          <Icon name="Undo2" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().redo().run()} className={btn(false)} title="Повторить" disabled={!editor.can().redo()}>
          <Icon name="Redo2" size={13} />
        </button>
      </div>

      {/* Editor area */}
      <div className="relative px-3 py-2.5">
        {!value || value === "<p></p>" ? (
          <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-foreground/30">{placeholder}</span>
        ) : null}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
