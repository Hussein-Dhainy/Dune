import type { Dispatch, SetStateAction } from 'react'
import { defaultLighting } from '../scene/lighting'
import type { LightingSettings } from '../scene/lighting'

type Props = {
  lighting: LightingSettings
  setLighting: Dispatch<SetStateAction<LightingSettings>>
}

type SliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <label className="debug-field">
      <span>{label}<output>{value.toFixed(step < 1 ? 2 : 0)}</output></span>
      <input type="range" value={value} min={min} max={max} step={step}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    </label>
  )
}

export function LightingDebug({ lighting, setLighting }: Props) {
  const update = <Key extends keyof LightingSettings>(key: Key, value: LightingSettings[Key]) => {
    setLighting((current) => ({ ...current, [key]: value }))
  }

  const copySettings = () => {
    void navigator.clipboard?.writeText(JSON.stringify(lighting, null, 2))
  }

  return (
    <details className="debug-overlay lighting-debug" open>
      <summary>Lighting lab</summary>
      <div className="debug-color-grid">
        <label>Background <input type="color" value={lighting.background}
          onChange={(event) => update('background', event.currentTarget.value)} /></label>
        <label>Ambient <input type="color" value={lighting.ambientColor}
          onChange={(event) => update('ambientColor', event.currentTarget.value)} /></label>
        <label>Sun <input type="color" value={lighting.sunColor}
          onChange={(event) => update('sunColor', event.currentTarget.value)} /></label>
        <label>Sky fill <input type="color" value={lighting.skyColor}
          onChange={(event) => update('skyColor', event.currentTarget.value)} /></label>
        <label>Ground fill <input type="color" value={lighting.groundColor}
          onChange={(event) => update('groundColor', event.currentTarget.value)} /></label>
        <label>Core glow <input type="color" value={lighting.glowColor}
          onChange={(event) => update('glowColor', event.currentTarget.value)} /></label>
      </div>
      <Slider label="Ambient" value={lighting.ambientIntensity} min={0} max={3} step={0.05}
        onChange={(value) => update('ambientIntensity', value)} />
      <Slider label="Sun intensity" value={lighting.sunIntensity} min={0} max={8} step={0.05}
        onChange={(value) => update('sunIntensity', value)} />
      <Slider label="Sun X" value={lighting.sunPositionX} min={-50} max={50} step={1}
        onChange={(value) => update('sunPositionX', value)} />
      <Slider label="Sun Y" value={lighting.sunPositionY} min={2} max={60} step={1}
        onChange={(value) => update('sunPositionY', value)} />
      <Slider label="Sun Z" value={lighting.sunPositionZ} min={-50} max={50} step={1}
        onChange={(value) => update('sunPositionZ', value)} />
      <Slider label="Hemisphere" value={lighting.hemisphereIntensity} min={0} max={2} step={0.05}
        onChange={(value) => update('hemisphereIntensity', value)} />
      <Slider label="Exposure" value={lighting.exposure} min={0.25} max={2} step={0.05}
        onChange={(value) => update('exposure', value)} />
      <Slider label="Base movement" value={lighting.baseMovement} min={0} max={1} step={0.01}
        onChange={(value) => update('baseMovement', value)} />
      <Slider label="Hover radius" value={lighting.hoverRadius} min={0.5} max={6} step={0.05}
        onChange={(value) => update('hoverRadius', value)} />
      <Slider label="Hover strength" value={lighting.hoverStrength} min={0} max={1} step={0.01}
        onChange={(value) => update('hoverStrength', value)} />
      <Slider label="Hover ease" value={lighting.hoverEase} min={1} max={20} step={0.5}
        onChange={(value) => update('hoverEase', value)} />
      <Slider label="Seam glow" value={lighting.glowSeamIntensity} min={0} max={12} step={0.1}
        onChange={(value) => update('glowSeamIntensity', value)} />
      <Slider label="Seam width" value={lighting.glowSeamWidth} min={0.5} max={5} step={0.1}
        onChange={(value) => update('glowSeamWidth', value)} />
      <Slider label="Core glow" value={lighting.glowCoreIntensity} min={0} max={15} step={0.1}
        onChange={(value) => update('glowCoreIntensity', value)} />
      <Slider label="Pulse glow boost" value={lighting.glowPulseBoost} min={0} max={8} step={0.1}
        onChange={(value) => update('glowPulseBoost', value)} />
      <Slider label="Bloom" value={lighting.bloomIntensity} min={0} max={4} step={0.05}
        onChange={(value) => update('bloomIntensity', value)} />
      <Slider label="Bloom threshold" value={lighting.bloomThreshold} min={0} max={4} step={0.05}
        onChange={(value) => update('bloomThreshold', value)} />
      <Slider label="Bloom smoothing" value={lighting.bloomSmoothing} min={0} max={1} step={0.01}
        onChange={(value) => update('bloomSmoothing', value)} />
      <div className="debug-actions">
        <button onClick={() => setLighting(defaultLighting)}>Reset</button>
        <button onClick={copySettings}>Copy values</button>
      </div>
    </details>
  )
}
