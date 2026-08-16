import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"

/** Ссылка на страницу стресс-тестера в шапке сайта.
 *  Ставится СЛЕВА от переключателя темы. На узких экранах текст скрыт,
 *  остаётся только иконка — иначе шапка переполняется на телефоне. */
export default function StressTesterLink() {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate("/stresstester")}
      title="Скачать StressTester — проверка стабильности ПК"
      style={{ cursor: "pointer" }}
      className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm text-foreground/70 transition-colors hover:border-primary hover:text-foreground"
    >
      <Icon name="Activity" size={15} className="shrink-0 text-primary" />
      <span className="hidden lg:inline whitespace-nowrap">Скачать StressTester</span>
    </button>
  )
}
