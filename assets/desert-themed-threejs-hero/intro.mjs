import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 560, height: 360 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => { if (["error","warning"].includes(m.type())) logs.push(m.type()+": "+m.text().slice(0,1200)); });
page.on("pageerror", (e) => logs.push("PAGEERROR: "+String(e).slice(0,1200)));
await page.goto("file:///tmp/pw/test.html");
const t0 = Date.now();
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => {
    const prog = document.querySelector('[class*="text-[11px]"]');
    const cta = [...document.querySelectorAll("div")].find((d) => d.className.includes("bottom-3"));
    return { prog: prog ? prog.textContent.trim() : null, ctaOpacity: cta ? +getComputedStyle(cta).opacity : -1 };
  });
  console.log(((Date.now()-t0)/1000).toFixed(0)+"s  "+JSON.stringify(st));
  if (st.ctaOpacity > 0.9) break;
}
await page.screenshot({ path: "/home/user/sandbox/.shots/intro.png", timeout: 120000 });
console.log("LOGS:\n"+(logs.length?logs.join("\n---\n"):"(none)"));
await browser.close();
