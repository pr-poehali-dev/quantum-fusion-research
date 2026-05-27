// ─── Палитра C-Cables PET 4мм (все кабели кроме 12V-2x6) ─────────────────────
export const PALETTE: { id: string; label: string; en: string; hex: string; uv?: boolean }[] = [
  // Белые / серые / чёрные
  { id: "perl-white",          label: "Жемчужно-белый",       en: "Perl White",           hex: "#f5f0eb" },
  { id: "white",               label: "Белый",                en: "White",                hex: "#f2f2f2" },
  { id: "light-gray",          label: "Светло-серый",         en: "Light gray (Silver)",  hex: "#b8bfc8" },
  { id: "billet-gray",         label: "Базовый серый",        en: "Billet gray",          hex: "#8a9099" },
  { id: "dark-gray",           label: "Темно-серый",          en: "Dark gray",            hex: "#555c63" },
  { id: "carbon-gray",         label: "Карбоновый серый",     en: "Carbon gray",          hex: "#3d4147" },
  { id: "gunmetal",            label: "Графит",               en: "Gunmetal",             hex: "#2e3238" },
  { id: "black",               label: "Черный",               en: "Black",                hex: "#1a1a1a" },
  { id: "light-carbon",        label: "Светлый карбон",       en: "Light Carbon",         hex: "#2d3035" },
  { id: "carbon",              label: "Карбон",               en: "Carbon",               hex: "#1e2125" },
  { id: "bw-mix",              label: "Черно-белый микс",     en: "Black & White mix",    hex: "#888888" },
  { id: "white-lines-carbon",  label: "Карбон с белыми стежками", en: "White Lines Carbon", hex: "#252830" },
  // Желтые / оранжевые
  { id: "citron",              label: "Цитрон",               en: "Citron",               hex: "#c8d400", uv: true },
  { id: "yellow",              label: "Желтый",               en: "Yellow",               hex: "#f5c800" },
  { id: "gold",                label: "Золотой",              en: "Gold",                 hex: "#c8920a" },
  { id: "terracotta",          label: "Терракотовый",         en: "Terracotta",           hex: "#b5633a" },
  { id: "acid-orange",         label: "Кислотно-оранжевый",   en: "Acid orange",          hex: "#ff8c00", uv: true },
  { id: "orange",              label: "Оранж",                en: "Orange",               hex: "#f07000", uv: true },
  { id: "pumpkin",             label: "Тыква",                en: "Pumpkin orange",       hex: "#d45f10" },
  { id: "orange-bk-mix",       label: "Оранжево-черный микс", en: "Orange & Black mix",   hex: "#a03a00" },
  // Красные / бордо
  { id: "bordo",               label: "Бордовый",             en: "Bordo",                hex: "#7a1030" },
  { id: "bordo-bk-mix",        label: "Черно-бордовый микс",  en: "Bordo & Black mix",    hex: "#4a0a1a" },
  { id: "red",                 label: "Красный",              en: "Red",                  hex: "#cc1515" },
  { id: "scarlet",             label: "Алый (красный)",       en: "Scarlet",              hex: "#e02020" },
  { id: "pink",                label: "Розовый",              en: "Pink",                 hex: "#e8207a" },
  { id: "candy-cane",          label: "Карамельная трость",   en: "Candy cane",           hex: "#d44060" },
  { id: "midnight-red",        label: "Полночный красный",    en: "Midnight Red",         hex: "#5a0a20", uv: true },
  // Синие
  { id: "peri-blue",           label: "Перламутровый голубой",en: "Peri Blue",            hex: "#90b8e0" },
  { id: "aqua-blue",           label: "Аква",                 en: "Aqua blue",            hex: "#30c0e0" },
  { id: "aquaterra",           label: "Акватерра",            en: "Aquaterra",            hex: "#00b0d0" },
  { id: "navy-blue",           label: "Темно-синий",          en: "Navy blue",            hex: "#1040a0" },
  { id: "meteor-shower",       label: "Метеоритный дождь",    en: "Meteor shower",        hex: "#1a3060" },
  // Фиолетовые / зеленые
  { id: "lavender",            label: "Лавандовый",           en: "Lavender",             hex: "#8868c8" },
  { id: "purple",              label: "Фиолетовый",           en: "Purple",               hex: "#6030a8" },
  { id: "purple-bk-mix",       label: "Фиолетово-черный микс",en: "Purple & Black mix",   hex: "#30104a" },
  { id: "army-green",          label: "Армейский зеленый",    en: "Army Green",           hex: "#3a5030" },
  { id: "nvidia-green",        label: "Зеленый NV",           en: "NVIDIA green",         hex: "#76b900" },
  { id: "acid-green",          label: "Кислотно-зеленый",     en: "Acid green",           hex: "#50e000", uv: true },
  { id: "toxic-rain",          label: "Кислотный дождь",      en: "Toxic Rain",           hex: "#2a4010" },
]

// ─── Палитра C-Cables PET 2мм (только 12V-2x6) ───────────────────────────────
export const PALETTE_12V: { id: string; label: string; en: string; hex: string; uv?: boolean }[] = [
  { id: "white",         label: "Белый",                en: "White",              hex: "#f2f2f2" },
  { id: "light-gray",    label: "Светло-серый",         en: "Light gray (Silver)", hex: "#b8bfc8" },
  { id: "dark-gray",     label: "Темно-серый",          en: "Dark gray",          hex: "#555c63" },
  { id: "carbon-gray",   label: "Карбоновый серый",     en: "Carbon gray",        hex: "#3d4147" },
  { id: "gunmetal",      label: "Графит",               en: "Gunmetal",           hex: "#2e3238" },
  { id: "black",         label: "Черный",               en: "Black",              hex: "#1a1a1a" },
  { id: "carbon",        label: "Карбон",               en: "Carbon",             hex: "#1e2125" },
  { id: "citron",        label: "Цитрон",               en: "Citron",             hex: "#c8d400", uv: true },
  { id: "yellow",        label: "Желтый",               en: "Yellow",             hex: "#f5c800" },
  { id: "gold",          label: "Золотой",              en: "Gold",               hex: "#c8920a" },
  { id: "terracotta",    label: "Терракотовый",         en: "Terracotta",         hex: "#b5633a" },
  { id: "orange",        label: "Оранж",                en: "Orange",             hex: "#f07000", uv: true },
  { id: "red",           label: "Красный",              en: "Red",                hex: "#cc1515" },
  { id: "scarlet",       label: "Алый (красный)",       en: "Scarlet",            hex: "#e02020" },
  { id: "pink",          label: "Розовый",              en: "Pink",               hex: "#e8207a" },
  { id: "aqua-blue",     label: "Аква",                 en: "Aqua blue",          hex: "#30c0e0" },
  { id: "aquaterra",     label: "Акватерра",            en: "Aquaterra",          hex: "#00b0d0" },
  { id: "navy-blue",     label: "Темно-синий",          en: "Navy blue",          hex: "#1040a0" },
  { id: "meteor-shower", label: "Метеоритный дождь",    en: "Meteor shower",      hex: "#1a3060" },
  { id: "purple",        label: "Фиолетовый",           en: "Purple",             hex: "#6030a8" },
  { id: "acid-green",    label: "Кислотно-зеленый",     en: "Acid green",         hex: "#50e000", uv: true },
]

export const DEFAULT_COLOR = "black"
export const DEFAULT_HEX = "#1a1a1a"

export const getHex = (id: string, pal: typeof PALETTE = PALETTE) =>
  (pal as typeof PALETTE).find(p => p.id === id)?.hex ?? DEFAULT_HEX
export const getLabel = (id: string, pal: typeof PALETTE = PALETTE) =>
  (pal as typeof PALETTE).find(p => p.id === id)?.label ?? id
export const getEn = (id: string, pal: typeof PALETTE = PALETTE) =>
  (pal as typeof PALETTE).find(p => p.id === id)?.en ?? id

// ─── Типы ────────────────────────────────────────────────────────────────────
export const CPU_TYPES = ["8-pin", "8+4-pin", "8+8-pin"] as const
export const GPU_TYPES = ["8-pin", "8+8-pin", "8+8+8-pin", "12V-2x6"] as const
export type CpuType = typeof CPU_TYPES[number]
export type GpuType = typeof GPU_TYPES[number]

export const CPU_PINS: Record<CpuType, number> = { "8-pin": 4, "8+4-pin": 6, "8+8-pin": 8 }
export const GPU_PINS: Record<GpuType, number> = { "8-pin": 4, "8+8-pin": 8, "8+8+8-pin": 12, "12V-2x6": 6 }
export const ATX_PINS = 12

export const PIN_W = 22
export const PIN_H = 34
export const PIN_GAP = 6
export const WIRE_LEN = 80

export type PinColors = Record<string, string>

export function makePinKey(cable: string, idx: number) { return `${cable}:${idx}` }
export function initPins(prefix: string, count: number): PinColors {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [makePinKey(prefix, i), DEFAULT_COLOR]))
}
export function pinKeys(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => makePinKey(prefix, i))
}
