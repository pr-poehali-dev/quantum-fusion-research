import Icon from "@/components/ui/icon"

/** Фон-заглушка для товара без фотографий. */
export const PHOTO_PLACEHOLDER_URL =
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/13a115f6-3c88-469e-ba7a-9a6a5393fc94.jpg"

/**
 * «Фото готовится» — то, что видно на месте картинки товара, у которого
 * фотографий пока нет. Раньше такие товары просто прятали из каталога,
 * теперь они показываются с этой заглушкой.
 */
export default function PhotoComingSoon({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const icon = size === "sm" ? 16 : size === "lg" ? 30 : 22
  const text = size === "sm" ? "text-[10px]" : size === "lg" ? "text-sm" : "text-[11px]"
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-muted/30">
      <img
        src={PHOTO_PLACEHOLDER_URL}
        alt=""
        aria-hidden
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover opacity-50"
      />
      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <Icon name="Camera" size={icon} className="text-foreground/40" />
        <span className={`${text} font-medium text-foreground/45`}>Фото готовится</span>
      </div>
    </div>
  )
}
