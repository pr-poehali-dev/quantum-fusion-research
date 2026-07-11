import type { ComponentType } from "react"
import { Shader, ChromaFlow as ChromaFlowRaw, Swirl as SwirlRaw } from "shaders/react"

// Тяжёлый WebGL-фон главной страницы (библиотека shaders ~6 МБ).
// Вынесен в отдельный компонент и грузится через React.lazy — чтобы код
// шейдеров попадал в отдельный чанк и НЕ раздувал первичную загрузку главной,
// а также вообще не тянулся на устройствах, где шейдеры выключены (слабый GPU).

// Пропсы шейдеров типизированы библиотекой неполно (нет detail/coarse*/…),
// поэтому приводим к свободному типу — так же, как это работало в Index.tsx.
const Swirl = SwirlRaw as ComponentType<Record<string, unknown>>
const ChromaFlow = ChromaFlowRaw as ComponentType<Record<string, unknown>>

type ShaderColors = {
  colorA: string
  colorB: string
  base: string
  glow: string
}

interface Props {
  shaderColors: ShaderColors
  mode: "light" | "dark"
}

export default function ShaderBackground({ shaderColors, mode }: Props) {
  return (
    <Shader className="absolute inset-0 h-full w-full">
      <Swirl
        colorA={shaderColors.colorA}
        colorB={shaderColors.colorB}
        speed={0.5}
        detail={0.6}
        blend={55}
        coarseX={45}
        coarseY={45}
        mediumX={45}
        mediumY={45}
        fineX={45}
        fineY={45}
      />
      <ChromaFlow
        baseColor={shaderColors.base}
        upColor={shaderColors.base}
        downColor={mode === "light" ? "#dddddd" : "#080000"}
        leftColor={shaderColors.base}
        rightColor={shaderColors.base}
        intensity={mode === "light" ? 0.5 : 0.7}
        radius={1.9}
        momentum={22}
        maskType="alpha"
        opacity={mode === "light" ? 0.55 : 0.8}
      />
    </Shader>
  )
}