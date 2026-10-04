"use client";

import { useEffect, useState } from "react";
import type { Role } from "@routelanka/domain";
import { Shell } from "@/components/Shell";
import { Btn, Card, Chip } from "@/components/ui";
import { api } from "@/lib/api";
import { outletById, seed, vehicleById, vehicleLabel } from "@/lib/seed";

interface Member {
  id: string;
  username: string;
  name: string;
  role: Role;
  depot: string | null;
  outlet_id: string | null;
  district: string | null;
  vehicle_id: string | null;
  active: boolean;
  demo: boolean;
  created_at: string;
  created_by: string | null;
}

const ROLE_LABEL: Record<Role, string> = { dispatcher: "Dispatcher", loader: "Loader", driver: "Driver", store: "Store manager" };
const ROLE_ORDER: Role[] = ["driver", "loader", "store", "dispatcher"];
const SCOPE_LABEL: Record<Role, string> = { dispatcher: "Depot", loader: "Depot", driver: "Vehicle", store: "Covers" };
const depots = () => [...new Set(seed.vehicles.map((v) => v.depot))].sort();
const districts = () => [...new Set(seed.outlets.map((o) => o.district))].sort();
const storesIn = (d: string) => seed.outlets.filter((o) => o.district === d);
/** A store manager's scope in the form: "district:Kandy" for an area manager, else an outlet id. */
const DISTRICT = "district:";

/** Where the person works, in words. */
function worksOn(m: Pick<Member, "role" | "depot" | "outlet_id" | "district" | "vehicle_id">) {
  if (m.role === "store" && m.district) return `All ${storesIn(m.district).length} stores in ${m.district}`;
  if (m.role === "store" && m.outlet_id) {
    const o = outletById.get(m.outlet_id);
    return o ? `${m.outlet_id} · ${o.brand} ${o.district}` : m.outlet_id;
  }
  if (m.role === "driver" && m.vehicle_id) return `${vehicleLabel(vehicleById.get(m.vehicle_id)) || m.vehicle_id}${m.depot ? ` · ${m.depot}` : ""}`;
  return m.depot ? `${m.depot} depot` : "—";
}

/** A temporary password to hand over: 10 characters, no look-alike letters or digits. */
function tempPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

const input = "mt-1 h-10 w-full rounded-md border border-line bg-card px-3 outline-none focus:border-night focus:ring-2 focus:ring-hivis/60";

export default function Team() {
  const [people, setPeople] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Role | "all">("all");
  const [panel, setPanel] = useState<{ mode: "add" } | { mode: "edit"; id: string } | null>(null);
  const [handover, setHandover] = useState<{ name: string; username: string; password: string } | null>(null);

  useEffect(() => {
    let live = true;
    api<{ people: Member[] }>("/team")
      .then((r) => live && setPeople(r.people))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  const active = (people ?? []).filter((p) => p.active);
  const shown = (people ?? []).filter((p) => filter === "all" || p.role === filter);
  const editing = panel?.mode === "edit" ? people?.find((p) => p.id === panel.id) : undefined;
  const takenVehicles = new Map(active.filter((p) => p.role === "driver" && p.vehicle_id).map((p) => [p.vehicle_id!, p]));

  return (
    <Shell role="dispatcher" width="wide">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-cond text-2xl font-bold leading-tight">Team</h1>
        </div>
        <Btn
          variant="primary"
          onClick={() => {
            setHandover(null);
            setPanel({ mode: "add" });
          }}
        >
          Add person
        </Btn>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {ROLE_ORDER.map((r) => {
          const n = active.filter((p) => p.role === r);
          return (
            <div key={r} className="bg-card px-4 py-3">
              <dt className="text-xs text-mute">{ROLE_LABEL[r]}s</dt>
              <dd className="font-cond text-3xl font-bold leading-tight">{n.length}</dd>
              <dd className="text-xs text-mute">
                {r === "driver" ? `${n.length} of ${seed.vehicles.length} vehicles have a driver's phone` : r === "store" ? `${seed.outlets.filter((o) => n.some((p) => p.outlet_id === o.outlet_id || p.district === o.district)).length} of ${seed.outlets.length} stores covered` : `${depots().filter((d) => n.some((p) => p.depot === d)).join(", ") || "no depot yet"}`}
              </dd>
            </div>
          );
        })}
      </dl>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-late/40 bg-late-soft px-3 py-2 text-sm font-semibold text-late">
          {error}
        </p>
      )}

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <p className="mr-auto font-semibold">People</p>
            <div role="radiogroup" aria-label="Role" className="inline-flex flex-wrap rounded-md border border-line bg-card p-0.5 text-sm">
              {(["all", ...ROLE_ORDER] as const).map((r) => (
                <button key={r} role="radio" aria-checked={filter === r} onClick={() => setFilter(r)} className={`rounded px-2.5 py-1 font-medium ${filter === r ? "bg-night text-white" : "text-mute hover:text-night"}`}>
                  {r === "all" ? "All" : `${ROLE_LABEL[r]}s`}
                </button>
              ))}
            </div>
          </div>
          {!people ? (
            <p className="px-4 py-6 text-sm text-mute">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-line text-left text-xs text-mute">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Works on</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} className={`border-t border-line/60 ${panel?.mode === "edit" && panel.id === p.id ? "bg-amber-soft" : ""} ${p.active ? "" : "text-mute"}`}>
                      <td className="px-4 py-2.5">
                        <span className="block font-semibold">{p.name}</span>
                        <span className="block font-cond text-sm text-mute">{p.username}</span>
                      </td>
                      <td className="px-3 py-2.5">{ROLE_LABEL[p.role]}</td>
                      <td className="px-3 py-2.5">{worksOn(p)}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {p.active ? <Chip tone="ok">Active</Chip> : <Chip>Deactivated</Chip>}
                          {p.demo && <Chip tone="hivis">Demo</Chip>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Btn
                          onClick={() => {
                            setHandover(null);
                            setPanel({ mode: "edit", id: p.id });
                          }}
                        >
                          {p.demo ? "View" : "Edit"}
                        </Btn>
                      </td>
                    </tr>
                  ))}
                  {!shown.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-mute">
                        No one in this role yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4 lg:sticky lg:top-4">
          {handover && <Handover h={handover} onClose={() => setHandover(null)} />}
          {panel?.mode === "add" && (
            <PersonForm
              key="add"
              takenVehicles={takenVehicles}
              onCancel={() => setPanel(null)}
              onSaved={(list, h) => {
                setPeople(list);
                setPanel(null);
                setHandover(h ?? null);
              }}
            />
          )}
          {editing && (
            <PersonForm
              key={editing.id}
              member={editing}
              takenVehicles={takenVehicles}
              onCancel={() => setPanel(null)}
              onSaved={(list, h) => {
                setPeople(list);
                setHandover(h ?? null);
              }}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

function Handover({ h, onClose }: { h: { name: string; username: string; password: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `RouteLanka sign-in for ${h.name}\nUsername: ${h.username}\nTemporary password: ${h.password}`;
  return (
    <Card className="border-l-4 border-l-ok p-4">
      <p className="font-semibold">Sign-in details for {h.name}</p>
      <p className="mt-1 text-sm text-mute">Give these to {h.name} in person or by message. The password is shown only now.</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-paper px-3 py-2 text-sm">
        <dt className="text-mute">Username</dt>
        <dd className="font-cond text-base font-semibold">{h.username}</dd>
        <dt className="text-mute">Password</dt>
        <dd className="font-cond text-base font-semibold">{h.password}</dd>
      </dl>
      <div className="mt-3 flex gap-2">
        <Btn
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {}
          }}
        >
          {copied ? "Copied" : "Copy details"}
        </Btn>
        <Btn variant="ghost" onClick={onClose}>
          Done
        </Btn>
      </div>
    </Card>
  );
}

function PersonForm({
  member,
  takenVehicles,
  onCancel,
  onSaved,
}: {
  member?: Member;
  takenVehicles: Map<string, Member>;
  onCancel: () => void;
  onSaved: (people: Member[], handover?: { name: string; username: string; password: string }) => void;
}) {
  const adding = !member;
  const [role, setRole] = useState<Role>(member?.role ?? "driver");
  const [name, setName] = useState(member?.name ?? "");
  const [username, setUsername] = useState(member?.username ?? "");
  const [password, setPassword] = useState(() => (adding ? tempPassword() : ""));
  const [depot, setDepot] = useState(member?.depot ?? seed.personas.dispatcher.depot);
  const [outlet, setOutlet] = useState(member?.district ? DISTRICT + member.district : (member?.outlet_id ?? ""));
  const [vehicle, setVehicle] = useState(member?.vehicle_id ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = !!member?.demo;

  // Suggest a username from the name, the way the demo accounts are named (first name + where they work).
  const suggest = (n: string, r = role, place = r === "store" ? outlet : r === "driver" ? vehicle : depot) => {
    const first = n.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
    const where = (r === "dispatcher" ? "dispatch" : place.startsWith(DISTRICT) ? `${place.slice(DISTRICT.length)}area` : place).toLowerCase().replace(/[^a-z0-9]/g, "");
    return first && where ? `${first}.${where}` : first;
  };
  const autoName = adding && (!username || username === suggest(name));

  const save = async (patch?: { active?: boolean }) => {
    setErr("");
    setBusy(true);
    try {
      const scope =
        role === "store" ? (outlet.startsWith(DISTRICT) ? { district: outlet.slice(DISTRICT.length), outlet_id: "" } : { outlet_id: outlet, district: "" })
        : role === "driver" ? { vehicle_id: vehicle } : { depot };
      if (adding) {
        const r = await api<{ people: Member[] }>("/team", { role, name, username, password, ...scope });
        onSaved(r.people, { name: name.trim(), username: username.trim().toLowerCase(), password });
      } else if (patch) {
        const r = await api<{ people: Member[] }>(`/team/${member.id}`, patch);
        onSaved(r.people);
      } else {
        const r = await api<{ people: Member[] }>(`/team/${member.id}`, { name, ...scope, ...(password ? { password } : {}) });
        onSaved(r.people, password ? { name: name.trim(), username: member.username, password } : undefined);
        setPassword("");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <div className="mr-auto">
          <p className="font-cond text-xl font-bold">{adding ? "Add a person" : member.name}</p>
          {!adding && (
            <p className="text-xs text-mute">
              {ROLE_LABEL[member.role]} · {member.username}
              {member.created_by ? ` · added by ${member.created_by}` : ""}
            </p>
          )}
        </div>
        <button onClick={onCancel} className="grid size-8 place-items-center rounded-md text-mute hover:bg-paper" aria-label="Close">
          ×
        </button>
      </div>

      {locked ? (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            <span className="text-mute">Works on:</span> {worksOn(member)}
          </p>
          <p className="rounded-md bg-amber-soft px-3 py-2">This is one of the four demo accounts used in the judge walkthrough, so it can&apos;t be changed or deactivated here.</p>
        </div>
      ) : (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {adding && (
            <fieldset>
              <legend className="text-sm font-semibold">Role</legend>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {ROLE_ORDER.map((r) => (
                  <button
                    type="button"
                    key={r}
                    aria-pressed={role === r}
                    onClick={() => {
                      if (autoName) setUsername(suggest(name, r));
                      setRole(r);
                    }}
                    className={`rounded-md border px-3 py-2 text-left text-sm font-semibold ${role === r ? "border-night bg-night text-white" : "border-line hover:border-night"}`}
                  >
                    {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <label className="block">
            <span className="text-sm font-semibold">Full name</span>
            <input
              value={name}
              onChange={(e) => {
                if (autoName) setUsername(suggest(e.target.value));
                setName(e.target.value);
              }}
              required
              maxLength={60}
              className={input}
            />
          </label>

          {role === "store" ? (
            <label className="block">
              <span className="text-sm font-semibold">{SCOPE_LABEL.store}</span>
              <select
                value={outlet}
                onChange={(e) => {
                  if (autoName) setUsername(suggest(name, role, e.target.value));
                  setOutlet(e.target.value);
                }}
                required
                className={input}
              >
                <option value="">Choose a district or a store…</option>
                <optgroup label="Area manager: every store in a district">
                  {districts().map((d) => (
                    <option key={d} value={DISTRICT + d}>
                      {d} district · {storesIn(d).length} stores
                    </option>
                  ))}
                </optgroup>
                {districts().map((d) => (
                  <optgroup key={d} label={`${d}: one store`}>
                    {storesIn(d).map((o) => (
                      <option key={o.outlet_id} value={o.outlet_id}>
                        {o.outlet_id} · {o.brand} {o.district}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : role === "driver" ? (
            <label className="block">
              <span className="text-sm font-semibold">{SCOPE_LABEL.driver}</span>
              <select
                value={vehicle}
                onChange={(e) => {
                  if (autoName) setUsername(suggest(name, role, e.target.value));
                  setVehicle(e.target.value);
                }}
                required
                className={input}
              >
                <option value="">Choose a vehicle…</option>
                {depots().map((d) => (
                  <optgroup key={d} label={`${d} depot`}>
                    {seed.vehicles
                      .filter((v) => v.depot === d)
                      .map((v) => {
                        const other = takenVehicles.get(v.vehicle_id);
                        const mine = other?.id === member?.id;
                        return (
                          <option key={v.vehicle_id} value={v.vehicle_id} disabled={!!other && !mine}>
                            {vehicleLabel(v)}
                            {other && !mine ? ` · ${other.name}` : ""}
                            {v.status === "in_workshop" ? " · in workshop" : ""}
                          </option>
                        );
                      })}
                  </optgroup>
                ))}
              </select>
              <span className="mt-1 block text-xs text-mute">One driver per vehicle. Their phone reports this vehicle&apos;s run each night.</span>
            </label>
          ) : (
            <label className="block">
              <span className="text-sm font-semibold">{SCOPE_LABEL[role]}</span>
              <select
                value={depot}
                onChange={(e) => {
                  if (autoName) setUsername(suggest(name, role, e.target.value));
                  setDepot(e.target.value);
                }}
                className={input}
              >
                {depots().map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}

          {adding && (
            <label className="block">
              <span className="text-sm font-semibold">Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,39}" autoCapitalize="none" spellCheck={false} className={`${input} font-cond text-base`} />
              <span className="mt-1 block text-xs text-mute">Letters, numbers, dots or dashes. Suggested from the name.</span>
            </label>
          )}

          <label className="block">
            <span className="text-sm font-semibold">{adding ? "Temporary password" : "Reset password"}</span>
            <div className="mt-1 flex gap-2">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={adding}
                minLength={8}
                maxLength={200}
                placeholder={adding ? "" : "Leave empty to keep the current one"}
                autoComplete="new-password"
                spellCheck={false}
                className={`${input} mt-0 font-cond text-base`}
              />
              <Btn type="button" onClick={() => setPassword(tempPassword())} className="h-10 shrink-0">
                Generate
              </Btn>
            </div>
          </label>

          {err && (
            <p role="alert" className="text-sm font-semibold text-late">
              {err}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Btn variant="primary" type="submit" disabled={busy}>
              {adding ? "Add person" : "Save changes"}
            </Btn>
            <Btn type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Btn>
            {!adding && (
              <Btn type="button" variant={member.active ? "danger" : "secondary"} className="ml-auto" disabled={busy} onClick={() => void save({ active: !member.active })}>
                {member.active ? "Deactivate" : "Reactivate"}
              </Btn>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
