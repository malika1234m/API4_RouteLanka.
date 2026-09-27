"use client";

export function DepotToggle({ depot, onChange }: { depot: string; onChange: (d: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Depot" className="inline-flex rounded-md border border-line bg-card p-0.5 text-sm">
      {["Peliyagoda", "Kandy"].map((d) => (
        <button key={d} role="radio" aria-checked={depot === d} onClick={() => onChange(d)} className={`rounded px-3 py-1 font-medium ${depot === d ? "bg-night text-white" : "text-mute hover:text-night"}`}>
          {d}
        </button>
      ))}
    </div>
  );
}
