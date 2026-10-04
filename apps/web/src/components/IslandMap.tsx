/**
 * Decorative map of the island for the sign-in hero: the two depots, the districts they serve and the
 * night's routes drawing in. Positions are approximate and only illustrate the network.
 */
const DEPOTS = [
  { name: "Peliyagoda", x: 92, y: 300 },
  { name: "Kandy", x: 168, y: 272 },
];
// name, x, y, depot, label side (1 = right of the dot, -1 = left)
const STOPS: [string, number, number, 0 | 1, 1 | -1][] = [
  ["Puttalam", 84, 205, 0, 1],
  ["Kurunegala", 132, 232, 0, -1],
  ["Gampaha", 104, 282, 0, 1],
  ["Kalutara", 104, 348, 0, 1],
  ["Galle", 124, 404, 0, -1],
  ["Matara", 160, 418, 0, 1],
  ["Matale", 168, 236, 1, 1],
  ["Kegalle", 132, 304, 1, 1],
  ["Nuwara Eliya", 180, 326, 1, -1],
  ["Badulla", 226, 304, 1, 1],
];
// A simplified outline of Sri Lanka.
const ISLAND =
  "M104 18c10-6 26-8 30 2 3 8-10 10-6 18 6 12 24 22 36 40 14 20 30 44 44 74 16 34 34 66 40 104 6 38 2 72-10 104-12 30-30 52-56 66-24 12-52 14-74 6-22-8-36-26-46-48-12-26-18-56-22-88-4-30-6-58-4-84 2-26 4-50 2-72-2-20-12-34-10-50 2-14 14-20 24-26 8-6 12-16 22-22 6-4 4-14 10-24z";

export function IslandMap({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 450" className={className} role="img" aria-label="RouteLanka's network: two depots and the districts they serve">
      <defs>
        <linearGradient id="isl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24344f" />
          <stop offset="1" stopColor="#1b2a43" />
        </linearGradient>
        <pattern id="dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" fill="#ffffff" opacity="0.08" />
        </pattern>
      </defs>
      <path d={ISLAND} fill="url(#isl)" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1.5" />
      <path d={ISLAND} fill="url(#dots)" />
      {STOPS.map(([n, x, y, d], i) => {
        const o = DEPOTS[d];
        const mx = (o.x + x) / 2 + (y > o.y ? -14 : 14);
        const my = (o.y + y) / 2;
        return (
          <path
            key={n}
            d={`M${o.x} ${o.y} Q${mx} ${my} ${x} ${y}`}
            fill="none"
            stroke={d ? "#7cc4f5" : "#f5b800"}
            strokeWidth="1.6"
            strokeLinecap="round"
            className="rl-draw"
            style={{ animationDelay: `${0.15 * i}s`, opacity: 0.85 }}
          />
        );
      })}
      {STOPS.map(([n, x, y, , side]) => (
        <g key={n}>
          <circle cx={x} cy={y} r="3.2" fill="#ffffff" />
          <text x={x + 7 * side} y={y + 3.5} fontSize="9" fill="#ffffff" opacity="0.6" textAnchor={side > 0 ? "start" : "end"}>
            {n}
          </text>
        </g>
      ))}
      {DEPOTS.map((d) => (
        <g key={d.name}>
          <circle cx={d.x} cy={d.y} r="4" fill="#f5b800" className="rl-pulse" />
          <circle cx={d.x} cy={d.y} r="6" fill="none" stroke="#f5b800" strokeWidth="1.5" />
          <text x={d.x + (d.name === "Kandy" ? 12 : -12)} y={d.y + 4} fontSize="10" fontWeight="700" fill="#ffd34d" textAnchor={d.name === "Kandy" ? "start" : "end"}>
            {d.name}
          </text>
        </g>
      ))}
    </svg>
  );
}
