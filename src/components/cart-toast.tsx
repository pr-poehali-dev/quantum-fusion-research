import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import Icon from "@/components/ui/icon"

interface CartToastProps {
  show: boolean
  productName: string
}

export function CartToast({ show, productName }: CartToastProps) {
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (show) {
      setMounted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
      const t = setTimeout(() => setVisible(false), 2500)
      const t2 = setTimeout(() => setMounted(false), 3000)
      return () => { clearTimeout(t); clearTimeout(t2) }
    }
  }, [show])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed left-1/2 top-6 z-[9999] -translate-x-1/2 transition-all duration-400"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? "0px" : "-20px"})`,
        cursor: "auto",
      }}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/10 px-5 py-3 shadow-2xl backdrop-blur-md">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500">
          <Icon name="Check" size={14} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-medium text-green-400">Добавлено в корзину</p>
          <p className="max-w-[200px] truncate text-xs text-green-400/70">{productName}</p>
        </div>
      </div>
    </div>,
    document.body
  )
}
