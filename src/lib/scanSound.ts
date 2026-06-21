// Звуковая обратная связь при сканировании/вводе серийников.
// Используем Web Audio API — без файлов, мгновенный отклик.

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  // На некоторых браузерах контекст «спит» до первого взаимодействия
  if (ctx.state === "suspended") ctx.resume().catch(() => {})
  return ctx
}

function beep(freqs: number[], duration: number, type: OscillatorType = "sine", gain = 0.12) {
  const ac = getCtx()
  if (!ac) return
  const now = ac.currentTime
  freqs.forEach((f, i) => {
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = type
    osc.frequency.value = f
    const start = now + i * duration
    const end = start + duration
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(g)
    g.connect(ac.destination)
    osc.start(start)
    osc.stop(end + 0.02)
  })
}

// Удачный скан — короткий восходящий «пилинь»
export function playScanOk() {
  beep([880, 1320], 0.08, "sine", 0.12)
}

// Неудачный скан (дубль / уже принят) — низкий двойной «бип»
export function playScanError() {
  beep([220, 180], 0.14, "square", 0.1)
}
