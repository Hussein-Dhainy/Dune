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
        <label>Fog <input type="color" value={lighting.fogColor}
          onChange={(event) => update('fogColor', event.currentTarget.value)} /></label>
        <label>Ambient <input type="color" value={lighting.ambientColor}
          onChange={(event) => update('ambientColor', event.currentTarget.value)} /></label>
        <label>Sun <input type="color" value={lighting.sunColor}
          onChange={(event) => update('sunColor', event.currentTarget.value)} /></label>
        <label>Exterior <input type="color" value={lighting.exteriorColor}
          onChange={(event) => update('exteriorColor', event.currentTarget.value)} /></label>
        <label>Core <input type="color" value={lighting.coreColor}
          onChange={(event) => update('coreColor', event.currentTarget.value)} /></label>
      </div>
      <Slider label="Sun intensity" value={lighting.sunIntensity} min={0} max={8} step={0.05}
        onChange={(value) => update('sunIntensity', value)} />
      <Slider label="Sun azimuth" value={lighting.sunAzimuth} min={-180} max={180} step={1}
        onChange={(value) => update('sunAzimuth', value)} />
      <Slider label="Sun elevation" value={lighting.sunElevation} min={5} max={85} step={1}
        onChange={(value) => update('sunElevation', value)} />
      <Slider label="Exterior intensity" value={lighting.exteriorIntensity} min={0} max={400} step={5}
        onChange={(value) => update('exteriorIntensity', value)} />
      <Slider label="Exterior azimuth" value={lighting.exteriorAzimuth} min={-180} max={180} step={1}
        onChange={(value) => update('exteriorAzimuth', value)} />
      <Slider label="Exterior elevation" value={lighting.exteriorElevation} min={10} max={85} step={1}
        onChange={(value) => update('exteriorElevation', value)} />
      <Slider label="Exterior radius" value={lighting.exteriorRadius} min={6} max={24} step={0.5}
        onChange={(value) => update('exteriorRadius', value)} />
      <Slider label="Exterior angle" value={lighting.exteriorAngle} min={0.25} max={1.2} step={0.01}
        onChange={(value) => update('exteriorAngle', value)} />
      <Slider label="Exterior softness" value={lighting.exteriorPenumbra} min={0} max={1} step={0.01}
        onChange={(value) => update('exteriorPenumbra', value)} />
      <Slider label="Exterior range" value={lighting.exteriorDistance} min={10} max={50} step={1}
        onChange={(value) => update('exteriorDistance', value)} />
      <Slider label="Exterior rim" value={lighting.exteriorRimStrength} min={0} max={1} step={0.01}
        onChange={(value) => update('exteriorRimStrength', value)} />
      <Slider label="Ambient" value={lighting.ambientIntensity} min={0} max={3} step={0.05}
        onChange={(value) => update('ambientIntensity', value)} />
      <Slider label="Exposure" value={lighting.exposure} min={0.25} max={2} step={0.05}
        onChange={(value) => update('exposure', value)} />
      <Slider label="Fog near" value={lighting.fogNear} min={0} max={150} step={1}
        onChange={(value) => update('fogNear', Math.min(value, lighting.fogFar - 1))} />
      <Slider label="Fog far" value={lighting.fogFar} min={20} max={400} step={1}
        onChange={(value) => update('fogFar', Math.max(value, lighting.fogNear + 1))} />
      <Slider label="Core light base" value={lighting.coreLightBase} min={0} max={80} step={1}
        onChange={(value) => update('coreLightBase', value)} />
      <Slider label="Core light pulse" value={lighting.coreLightPulse} min={0} max={180} step={1}
        onChange={(value) => update('coreLightPulse', value)} />
      <Slider label="Inner glow" value={lighting.innerGlowStrength} min={0} max={5} step={0.05}
        onChange={(value) => update('innerGlowStrength', value)} />
      <Slider label="Rim strength" value={lighting.rimStrength} min={0} max={2} step={0.05}
        onChange={(value) => update('rimStrength', value)} />
      <Slider label="Base movement" value={lighting.baseMovement} min={0} max={1} step={0.01}
        onChange={(value) => update('baseMovement', value)} />
      <Slider label="Bloom strength" value={lighting.bloomStrength} min={0} max={1.5} step={0.01}
        onChange={(value) => update('bloomStrength', value)} />
      <Slider label="Bloom radius" value={lighting.bloomRadius} min={0} max={1} step={0.01}
        onChange={(value) => update('bloomRadius', value)} />
      <Slider label="Bloom threshold" value={lighting.bloomThreshold} min={0} max={1} step={0.01}
        onChange={(value) => update('bloomThreshold', value)} />
      <label className="debug-toggle">
        <input type="checkbox" checked={lighting.shadows}
          onChange={(event) => update('shadows', event.currentTarget.checked)} /> Shadows
      </label>
      <div className="debug-actions">
        <button onClick={() => setLighting(defaultLighting)}>Reset</button>
        <button onClick={copySettings}>Copy values</button>
      </div>
    </details>
  )
}
