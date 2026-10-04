/* feTurbulence film grain (baseFrequency 0.04), tiled and jittered in CSS */
const svg =
  "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'>" +
  "<filter id='n' x='0' y='0' width='100%' height='100%'>" +
  "<feTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='3' stitchTiles='stitch'/>" +
  "<feColorMatrix type='saturate' values='0'/>" +
  "</filter>" +
  "<rect width='100%' height='100%' filter='url(%23n)'/></svg>";

export default function Grain() {
  return (
    <div
      aria-hidden
      className="grain"
      style={{ backgroundImage: `url("data:image/svg+xml;utf8,${svg}")` }}
    />
  );
}
