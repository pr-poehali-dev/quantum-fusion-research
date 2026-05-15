import { useState, useCallback } from "react"
import Cropper, { Area } from "react-easy-crop"
import Icon from "@/components/ui/icon"

interface AvatarCropModalProps {
  imageSrc: string
  onSave: (croppedBase64: string) => void
  onClose: () => void
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.src = imageSrc
  })
  const canvas = document.createElement("canvas")
  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(img, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height)
  return canvas.toDataURL("image/jpeg", 0.92)
}

export default function AvatarCropModal({ imageSrc, onSave, onClose }: AvatarCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels)
  }, [])

  const handleSave = async () => {
    if (!croppedAreaPixels) return
    setSaving(true)
    const cropped = await getCroppedImg(imageSrc, croppedAreaPixels)
    onSave(cropped)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Кадрировать фото</h3>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground transition-colors">
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Кропер */}
        <div className="relative bg-black" style={{ height: 300 }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Зум */}
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-3">
            <Icon name="ZoomOut" size={16} className="text-foreground/40 flex-shrink-0" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <Icon name="ZoomIn" size={16} className="text-foreground/40 flex-shrink-0" />
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm text-foreground/60 hover:text-foreground transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
