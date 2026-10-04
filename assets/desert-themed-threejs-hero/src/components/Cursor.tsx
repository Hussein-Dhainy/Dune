import { useEffect, useRef } from "react";
import gsap from "gsap";
import { STONE_HOVER_EVENT, type StoneHoverDetail } from "../scene/interaction";

/** Custom cursor: precise dot + lagging ring that swells over interactive things. */
export default function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const d = dot.current!;
    const r = ring.current!;
    gsap.set([d, r], { xPercent: -50, yPercent: -50, opacity: 0 });

    const dx = gsap.quickTo(d, "x", { duration: 0.06, ease: "power3.out" });
    const dy = gsap.quickTo(d, "y", { duration: 0.06, ease: "power3.out" });
    const rx = gsap.quickTo(r, "x", { duration: 0.5, ease: "power3.out" });
    const ry = gsap.quickTo(r, "y", { duration: 0.5, ease: "power3.out" });

    let shown = false;
    const move = (e: PointerEvent) => {
      if (!shown) {
        shown = true;
        gsap.set([d, r], { x: e.clientX, y: e.clientY });
        gsap.to([d, r], { opacity: 1, duration: 0.4 });
      }
      dx(e.clientX);
      dy(e.clientY);
      rx(e.clientX);
      ry(e.clientY);
    };
    let uiHot = false;
    let stoneHot = false;
    const updateHover = () => {
      const hot = uiHot || stoneHot;
      gsap.to(r, {
        scale: uiHot ? 1.9 : stoneHot ? 1.5 : 1,
        backgroundColor: hot ? "rgba(243,230,204,0.16)" : "rgba(243,230,204,0)",
        duration: 0.4,
        ease: "power3.out",
        overwrite: "auto",
      });
      gsap.to(d, { scale: hot ? 0.4 : 1, duration: 0.3, overwrite: "auto" });
    };
    const over = (e: MouseEvent) => {
      uiHot = e.target instanceof Element && Boolean(e.target.closest("button,a,input,[data-hover]"));
      updateHover();
    };
    const stoneHover = (event: Event) => {
      stoneHot = (event as CustomEvent<StoneHoverDetail>).detail.hovered;
      updateHover();
    };
    const down = () => gsap.to(r, {
      scale: (uiHot ? 1.9 : stoneHot ? 1.5 : 1) * 0.8,
      duration: 0.15,
      onComplete: updateHover,
      overwrite: "auto",
    });
    const leave = () => {
      shown = false;
      uiHot = false;
      stoneHot = false;
      updateHover();
      gsap.to([d, r], { opacity: 0, duration: 0.3 });
    };
    const enter = () => shown && gsap.to([d, r], { opacity: 1, duration: 0.3 });

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("mouseover", over);
    window.addEventListener("pointerdown", down);
    window.addEventListener(STONE_HOVER_EVENT, stoneHover);
    window.addEventListener("blur", leave);
    document.documentElement.addEventListener("mouseleave", leave);
    document.documentElement.addEventListener("mouseenter", enter);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("mouseover", over);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener(STONE_HOVER_EVENT, stoneHover);
      window.removeEventListener("blur", leave);
      document.documentElement.removeEventListener("mouseleave", leave);
      document.documentElement.removeEventListener("mouseenter", enter);
      gsap.killTweensOf([d, r]);
      dx.tween.kill();
      dy.tween.kill();
      rx.tween.kill();
      ry.tween.kill();
    };
  }, []);

  return (
    <>
      <div
        ref={ring}
        className="pointer-events-none fixed left-0 top-0 z-[60] h-9 w-9 rounded-full border border-[rgba(243,230,204,0.85)] opacity-0"
        style={{ boxShadow: "0 0 0 1px rgba(43,29,18,0.25)" }}
      />
      <div
        ref={dot}
        className="pointer-events-none fixed left-0 top-0 z-[61] h-1.5 w-1.5 rounded-full bg-[#f3e6cc] opacity-0"
        style={{ boxShadow: "0 0 0 1px rgba(43,29,18,0.35)" }}
      />
    </>
  );
}
