export const SLOT_LABELS: Record<string, { label: string; icon: string; required: boolean }> = {
  cpu:         { label: "Процессор",         icon: "Cpu",         required: true  },
  motherboard: { label: "Материнская плата", icon: "CircuitBoard",required: true  },
  gpu:         { label: "Видеокарта",        icon: "Monitor",     required: false },
  ram:         { label: "Оперативная память",icon: "MemoryStick", required: true  },
  storage:     { label: "Накопитель",        icon: "HardDrive",   required: false },
  cooling:     { label: "Система охлаждения",icon: "Wind",        required: true  },
  psu:         { label: "Блок питания",      icon: "Zap",         required: true  },
  case:        { label: "Корпус",            icon: "Box",         required: true  },
  fan:         { label: "Вентилятор",        icon: "Fan",         required: false },
}

export interface CatalogComp {
  id: number
  slot: string
  name: string
  brand?: string
  price: number
  specs: Record<string, string>
}

export interface SelectedComp {
  slot: string
  name: string
  price: number
  qty: number
  link?: string
  source: "catalog" | "custom"
  source_id?: number
}