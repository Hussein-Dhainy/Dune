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
        <label>Sky fill <input type="color" value={lighting.skyColor}
          onChange={(event) => update('skyColor', event.currentTarget.value)} /></label>
        <label>Ground fill <input type="color" value={lighting.groundColor}
          onChange={(event) => update('groundColor', event.currentTarget.value)} /></label>
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
      <Slider label="Fog density" value={lighting.fogDensity} min={0} max={0.03} step={0.0002}
        onChange={(value) => update('fogDensity', value)} />
      <Slider label="Base movement" value={lighting.baseMovement} min={0} max={1} step={0.01}
        onChange={(value) => update('baseMovement', value)} />
      <div className="debug-actions">
        <button onClick={() => setLighting(defaultLighting)}>Reset</button>
        <button onClick={copySettings}>Copy values</button>
      </div>
    </details>
  )
}
