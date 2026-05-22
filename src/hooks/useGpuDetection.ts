import { useState, useEffect } from "react"

type GpuResult = "capable" | "incapable" | "unknown" | "detecting"

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function getWebGLRenderer(): string | null {
  try {
    const canvas = document.createElement("canvas")
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl") as WebGLRenderingContext | null
    if (!gl) return null
    const ext = gl.getExtension("WEBGL_debug_renderer_info")
    if (!ext) return null
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string
  } catch {
    return null
  }
}

function classifyByRenderer(renderer: string): "capable" | "incapable" | null {
  const r = renderer.toLowerCase()
  // Явно дискретные карты — разрешаем
  if (
    r.includes("nvidia") ||
    r.includes("geforce") ||
    r.includes("quadro") ||
    r.includes("tesla") ||
    r.includes("radeon") ||
    r.includes("rx ") ||
    r.includes("vega") && r.includes("amd") ||
    r.includes("arc ") // Intel Arc — дискретная
  ) return "capable"

  // Интегрированная / программная графика — запрещаем
  if (
    r.includes("intel") ||
    r.includes("mesa") ||
    r.includes("llvm") ||
    r.includes("software") ||
    r.includes("swiftshader") ||
    r.includes("microsoft basic") ||
    r.includes("vmware") ||
    r.includes("virtualbox")
  ) return "incapable"

  return null
}

function measureFps(): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0
    const start = performance.now()
    const duration = 1500

    function tick() {
      frames++
      if (performance.now() - start < duration) {
        requestAnimationFrame(tick)
      } else {
        resolve(frames / (duration / 1000))
      }
    }

    requestAnimationFrame(tick)
  })
}

export function useGpuDetection(): { shaderEnabled: boolean; detecting: boolean; gpuRenderer: string | null } {
  const [result, setResult] = useState<GpuResult>("detecting")
  const [gpuRenderer, setGpuRenderer] = useState<string | null>(null)

  useEffect(() => {
    // Мобильные — не трогаем, шейдер всегда включён
    if (isMobile()) {
      setResult("capable")
      return
    }

    // prefers-reduced-motion — сразу выключаем
    if (prefersReducedMotion()) {
      setResult("incapable")
      return
    }

    const renderer = getWebGLRenderer()
    setGpuRenderer(renderer)

    if (renderer) {
      const classified = classifyByRenderer(renderer)

      if (classified === "capable") {
        setResult("capable")
        return
      }

      if (classified === "incapable") {
        setResult("incapable")
        return
      }
    }

    // Не удалось определить — замеряем FPS
    measureFps().then((fps) => {
      setResult(fps >= 30 ? "capable" : "incapable")
    })
  }, [])

  return {
    shaderEnabled: result === "capable",
    detecting: result === "detecting",
    gpuRenderer,
  }
}
