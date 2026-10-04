import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { DesertScene } from "./scene/DesertScene";
import { DesertWind } from "./scene/wind";
import Cursor from "./components/Cursor";
import Grain from "./components/Grain";

const textShadow = "0 0 14px rgba(43,29,18,0.55), 0 0 2px rgba(43,29,18,0.5)";
const INITIAL_STORM = 20;
const INITIAL_DISPERSE = 45;
const INITIAL_LIGHT = 1.2; // 0 - 2
const INITIAL_CONTRAST = 45; // 0 - 100
const INITIAL_GRAVITY = 0; // 0 = zero-G
const INITIAL_BLOOM = 50; // 50 → UnrealBloomPass 0.6
const monoStyle = { fontFamily: '"IBM Plex Mono", monospace', letterSpacing: "1.4px", textShadow } as const;

interface RangeControlProps {
  label: string;
  low: string;
  high: string;
  value: number;
  onChange: (value: number) => void;
  aria: string;
  valueText: string;
  min?: number;
  max?: number;
  step?: number;
}

/** One minimal IBM Plex Mono bar: LABEL  low --O-- high. */
function RangeControl({ label, low, high, value, onChange, aria, valueText, min = 0, max = 100, step = 1 }: RangeControlProps) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="pointer-events-auto flex items-center gap-2 whitespace-nowrap text-[10px] uppercase text-[#f3e6cc]" style={monoStyle}>
      <span>{label}</span>
      <span className="opacity-65">{low}</span>
      <input
        className="desert-range desert-range--bar"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        aria-label={aria}
        aria-valuetext={valueText}
        style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
      />
      <span className="opacity-65">{high}</span>
    </label>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DesertScene | null>(null);
  const windRef = useRef<DesertWind | null>(null);

  const [soundOn, setSoundOn] = useState(true);
  const [storm, setStorm] = useState(false);
  const [stormValue, setStormValue] = useState(INITIAL_STORM);
  const [disperseValue, setDisperseValue] = useState(INITIAL_DISPERSE);
  const [lightValue, setLightValue] = useState(INITIAL_LIGHT);
  const [contrastValue, setContrastValue] = useState(INITIAL_CONTRAST);
  const [gravityValue, setGravityValue] = useState(INITIAL_GRAVITY);
  const [bloomValue, setBloomValue] = useState(INITIAL_BLOOM);
  const [heartbeatOn, setHeartbeatOn] = useState(true);
  const [failed, setFailed] = useState(false);
  const soundWanted = useRef(true);
  const progressRef = useRef<HTMLSpanElement>(null);

  /* ---------------- boot the WebGL world ---------------- */
  useEffect(() => {
    let cancelled = false;
    const wind = new DesertWind();
    windRef.current = wind;

    let scene: DesertScene;
    try {
      scene = new DesertScene(canvasRef.current!);
    } catch {
      setFailed(true);
      wind.dispose();
      return;
    }
    sceneRef.current = scene;
    wind.setStormIntensity(INITIAL_STORM);
    scene.onAudioFrame = (distance, pan, fire) => {
      wind.setProximity(distance);
      wind.setPan(pan);
      wind.setFire(fire);
    };
    scene.setStormIntensity(INITIAL_STORM);
    scene.setDisperse(INITIAL_DISPERSE);
    scene.setInnerLight(INITIAL_LIGHT);
    scene.setInnerContrast(INITIAL_CONTRAST);
    scene.setHeartbeat(true);
    scene.setGravity(INITIAL_GRAVITY);
    scene.setBloom(INITIAL_BLOOM);

    const loader = loaderRef.current;
    const top = topRef.current;
    const cta = ctaRef.current;
    const intro = introRef.current;
    gsap.set(loader, { opacity: 1, display: "flex" });
    gsap.set(top, { opacity: 0 });
    gsap.set(cta, { opacity: 0, y: 16 });
    gsap.set(intro, { opacity: 1 });

    // Loader counter: BUILDING FIELD... 0-100%, ticking while the desert forms.
    const progress = { v: 0 };
    const progressTween = gsap.to(progress, {
      v: 100,
      duration: 4,
      ease: "power1.inOut",
      onUpdate: () => {
        if (progressRef.current) {
          progressRef.current.textContent = String(Math.round(progress.v)).padStart(2, "0");
        }
      },
    });

    scene.init().then(() => {
      if (cancelled) return;
      scene.play();
      // 0s - 1s stays black, then the desert is revealed underneath the loader.
      gsap.to(intro, {
        opacity: 0,
        duration: 0.8,
        delay: 1,
        ease: "power2.inOut",
        onComplete: () => {
          if (intro) intro.style.display = "none";
        },
      });
      gsap.to(loaderRef.current, {
        opacity: 0,
        duration: 1,
        delay: 3.6,
        ease: "power2.inOut",
        onComplete: () => {
          if (loaderRef.current) loaderRef.current.style.display = "none";
        },
      });
      // UI only appears once the field and pyramid have finished landing (10s intro).
      gsap.to(topRef.current, { opacity: 1, duration: 1.4, delay: 8 });
      gsap.to(ctaRef.current, { opacity: 1, y: 0, duration: 1.4, delay: 9, ease: "power3.out" });
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.error("The desert scene could not be initialized.", error);
      setFailed(true);
    });

    // browsers only allow audio after a gesture: first click/key anywhere starts the wind
    const unlock = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-wind-toggle]")) return;
      if (soundWanted.current && !wind.started) wind.enable();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      progressTween.kill();
      gsap.killTweensOf([loader, top, cta, intro]);
      scene.dispose();
      wind.dispose();
      scene.onAudioFrame = null;
      if (sceneRef.current === scene) sceneRef.current = null;
      if (windRef.current === wind) windRef.current = null;
    };
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    soundWanted.current = next;
    setSoundOn(next);
    if (next) windRef.current?.enable();
    else windRef.current?.disable();
  }, [soundOn]);

  const toggleStorm = useCallback(() => {
    const next = !storm;
    const value = next ? 90 : INITIAL_STORM;
    setStorm(next);
    setStormValue(value);
    sceneRef.current?.setStorm(next);
    windRef.current?.setStormIntensity(value);
  }, [storm]);

  const changeStorm = useCallback((value: number) => {
    setStormValue(value);
    setStorm(value >= 70);
    sceneRef.current?.setStormIntensity(value);
    windRef.current?.setStormIntensity(value);
  }, []);

  const changeDisperse = useCallback((value: number) => {
    setDisperseValue(value);
    sceneRef.current?.setDisperse(value);
  }, []);

  const changeLight = useCallback((value: number) => {
    setLightValue(value);
    sceneRef.current?.setInnerLight(value);
  }, []);

  const changeContrast = useCallback((value: number) => {
    setContrastValue(value);
    sceneRef.current?.setInnerContrast(value);
  }, []);

  const changeGravity = useCallback((value: number) => {
    setGravityValue(value);
    sceneRef.current?.setGravity(value);
  }, []);

  const changeBloom = useCallback((value: number) => {
    setBloomValue(value);
    sceneRef.current?.setBloom(value);
  }, []);

  const toggleHeartbeat = useCallback(() => {
    const next = !heartbeatOn;
    setHeartbeatOn(next);
    sceneRef.current?.setHeartbeat(next);
  }, [heartbeatOn]);

  return (
    <>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="An interactive sandstone pyramid in a desert sandstorm. Move over its individual stones to bring them to life."
        className="fixed left-0 top-0 h-screen w-screen"
        style={{ width: "100vw", height: "100vh" }}
      />

      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-20 transition-opacity duration-1000"
        style={{
          opacity: Math.max(0, (stormValue - 70) / 30) * 0.68,
          background: "radial-gradient(circle at 50% 46%, transparent 35%, rgba(28,16,8,0.38) 72%, rgba(17,9,4,0.88) 100%)",
        }}
      />

      {failed && (
        <div role="alert" className="fixed inset-0 z-[70] flex items-center justify-center bg-[#2b1d12] p-6 text-center text-[12px] tracking-[2px]">
          WEBGL IS REQUIRED TO ENTER THE DESERT
        </div>
      )}

      {/* loader */}
      <div
        ref={loaderRef}
        className="fixed inset-0 z-50 flex items-end justify-center bg-[#2b1d12] pb-10"
      >
        <span
          className="text-[11px] uppercase tracking-[3px] text-[#d9c5a5]"
          style={{ animation: "pulse-soft 1.6s ease-in-out infinite" }}
        >
          BUILDING FIELD... <span ref={progressRef}>00</span>%
        </span>
      </div>

      {/* minimal UI */}
      <div
        ref={topRef}
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between p-6 md:p-8"
      >
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          className="pointer-events-auto text-[12px] uppercase text-[#f3e6cc]"
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            letterSpacing: "2px",
            textShadow,
          }}
        >
          DESERT INC
        </a>
        <button
          data-wind-toggle
          onClick={toggleSound}
          aria-pressed={soundOn}
          className="pointer-events-auto text-[12px] uppercase text-[#f3e6cc] transition-opacity hover:opacity-70"
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            letterSpacing: "2px",
            textShadow,
            background: "none",
            border: 0,
            padding: 0,
          }}
        >
          [SOUND {soundOn ? "ON" : "OFF"}]
        </button>

        {/* HEARTBEAT toggle: top-centre, on its own */}
        <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center md:top-8">
          <button
            onClick={toggleHeartbeat}
            aria-pressed={heartbeatOn}
            className="pointer-events-auto whitespace-nowrap text-[10px] uppercase text-[#f3e6cc] transition-opacity hover:opacity-70"
            style={{ ...monoStyle, background: "none", border: 0, padding: 0 }}
          >
            Heartbeat [{heartbeatOn ? "ON" : "OFF"}]
          </button>
        </div>
      </div>

      {/* cinematic entry: page starts black, fades to the desert over 1s */}
      <div
        ref={introRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[55] bg-black"
      />

      <div
        ref={ctaRef}
        className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex flex-col items-center gap-3 px-3 sm:bottom-6 md:bottom-8"
      >
        <div className="pointer-events-auto">
          <button
            onClick={toggleStorm}
            aria-pressed={storm}
            className="group flex items-center gap-4 rounded-full border border-[rgba(243,230,204,0.55)] bg-[rgba(43,29,18,0.42)] py-2 pl-6 pr-2 text-[12px] uppercase text-[#f3e6cc] backdrop-blur-md transition-colors duration-500 hover:bg-[#f3e6cc] hover:text-[#2b1d12]"
            style={{ fontFamily: '"IBM Plex Mono", monospace', letterSpacing: "2px" }}
          >
            <span>{storm ? "Leave the storm" : "Enter the storm"}</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3e6cc] text-[#2b1d12] transition-colors duration-500 group-hover:bg-[#2b1d12] group-hover:text-[#f3e6cc]">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                className={`transition-transform duration-500 ${storm ? "-rotate-180" : ""}`}
              >
                <path d="M1 7h11M8 3l4 4-4 4" />
              </svg>
            </span>
          </button>
        </div>

        {/* THE 4 BARS:  [STORM]  [DISPERSE]  [INNER LIGHT + CONTRAST]  [GRAVITY] */}
        <div className="flex max-w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 lg:gap-x-7">
          <RangeControl
            label="Storm"
            low="Low"
            high="Heavy"
            value={stormValue}
            onChange={changeStorm}
            aria="Storm intensity"
            valueText={`${stormValue} percent`}
          />
          <RangeControl
            label="Disperse"
            low="0"
            high="100"
            value={disperseValue}
            onChange={changeDisperse}
            aria="Block disperse radius and intensity"
            valueText={`${disperseValue} percent`}
          />
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <RangeControl
              label="Inner light"
              low="Off"
              high="Bright"
              max={2}
              step={0.01}
              value={lightValue}
              onChange={changeLight}
              aria="Inner light intensity"
              valueText={`${lightValue.toFixed(2)} of 2`}
            />
            <RangeControl
              label="Contrast"
              low="Low"
              high="High"
              value={contrastValue}
              onChange={changeContrast}
              aria="Inner light contrast"
              valueText={`${contrastValue} percent`}
            />
          </div>
          <RangeControl
            label="Gravity"
            low="0 Zero-G"
            high="100 Heavy"
            value={gravityValue}
            onChange={changeGravity}
            aria="Gravity: zero-G float to heavy fall"
            valueText={
              gravityValue === 0 ? "zero gravity" : gravityValue >= 100 ? "heavy gravity" : `${gravityValue} percent`
            }
          />
          <RangeControl
            label="Bloom"
            low="Off"
            high="High"
            value={bloomValue}
            onChange={changeBloom}
            aria="Border glow bloom"
            valueText={`${bloomValue} percent`}
          />
        </div>
      </div>

      <Grain />
      <Cursor />
    </>
  );
}
