// Форматирование баллов бенчмарка — 1:1 с EXE (TestResultFormatter.cs).
// shortScore(score_text) → короткий балл для заголовка теста.
// statsLine(...) → подстрока "код: N · Xм Yс".

// Нормализация числа: убираем пробелы-разделители тысяч, запятую в точку.
function normNum(s: string): string {
  return s.replace(/\s+/g, "").replace(",", ".").replace(/\.$/, "")
}

// Шумовые строки, которые EXE игнорирует.
function isNoise(line: string): boolean {
  const s = line.trim()
  if (!s) return true
  if (/^={2,}/.test(s)) return true
  if (/^\(R\/U\s+MIPS/i.test(s)) return true
  if (/^Captured\s*:/i.test(s)) return true
  if (/^Tot\s*:/i.test(s)) return true
  if (/^Avr\s*:/i.test(s)) return true
  return false
}

// Короткий балл из score_text. Разбираем построчно, берём первое совпадение.
export function shortScore(scoreText: string | null | undefined): string {
  if (!scoreText) return ""
  const lines = String(scoreText).split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (isNoise(line)) continue

    // Superposition: "Superposition: 7198 (FPS 53.84)" → 7198
    let m = line.match(/^Superposition:\s*([\d][\d\s.,]*?)(?:\s*\(FPS|\s*$)/i)
    if (m) return normNum(m[1])

    // Cinebench: "Score: 22331" → "22331 CB"
    m = line.match(/score\s*[:=]\s*([\d][\d\s.,]*)/i)
    if (m) return `${normNum(m[1])} CB`

    // named + unit: "7-Zip: 133394 MIPS" → "133394 MIPS"
    m = line.match(/^[^:]+:\s*([\d][\d\s.,]*)\s*(MIPS|GB\/s|pts|points|CB)\b/i)
    if (m) return `${normNum(m[1])} ${m[2]}`

    // plain number + unit: "133394 MIPS" → "133394 MIPS"
    m = line.match(/^([\d][\d\s.,]*)\s*(MIPS|GB\/s|pts|points|CB)\b/i)
    if (m) return `${normNum(m[1])} ${m[2]}`

    // y-cruncher OK: "VT3: 15м OK" → "VT3 15м OK"
    m = line.match(/^(VT3|VST|FFT|SFT|N63|BBP)\s*:\s*([\d]+[м]?)\s*OK/i)
    if (m) return `${m[1]} ${m[2]} OK`

    // y-cruncher FAIL: "VT3 FAIL: ..." → "VT3 FAIL"
    m = line.match(/^(VT3|VST|FFT|SFT|N63|BBP)\s+FAIL/i)
    if (m) return `${m[1]} FAIL`
  }
  return ""
}

// Заголовок строки теста: test_name + " - " + shortScore (если есть).
export function testTitle(testName: string, scoreText: string | null | undefined): string {
  const ss = shortScore(scoreText)
  return ss ? `${testName} - ${ss}` : testName
}

// Подстрока статистики: "код: 0 · 4м 43с".
export function statsLine(
  exitCode: number | null | undefined,
  timedOut: boolean | undefined,
  durationSec: number | undefined,
): string {
  const parts: string[] = []
  if (exitCode !== null && exitCode !== undefined) parts.push(`код: ${exitCode}`)
  if (timedOut) parts.push("таймаут")
  const d = durationSec || 0
  if (d > 0.5) {
    if (d >= 60) parts.push(`${Math.floor(d / 60)}м ${Math.round(d % 60)}с`)
    else parts.push(`${Math.round(d)} сек`)
  }
  return parts.join(" · ")
}
