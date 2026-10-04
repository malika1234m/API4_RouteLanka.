/**
 * Staff accounts. Dispatchers add the people who use RouteLanka and tie each one to their work: a store
 * manager to an outlet (or an area manager to a district), a driver to a vehicle, a loader or dispatcher to a depot. They can also change
 * that, reset a password, or deactivate an account (which signs it out everywhere on its next request).
 * The four seeded walkthrough accounts are kept as they are.
 */
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { actor, HttpError } from "./auth";
import { sql } from "./db";

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,39}$/, "Usernames are 3 to 40 characters: letters, numbers, dots, dashes or underscores.");
const password = z.string().min(8, "Passwords need at least 8 characters.").max(200);
const name = z.string().trim().min(1, "Enter the person's name.").max(60);
const id = z.string().trim().max(20);

const createSchema = z.object({
  role: z.enum(["dispatcher", "loader", "driver", "store"]),
  name,
  username,
  password,
  depot: id.optional(),
  outlet_id: id.optional(),
  district: z.string().trim().max(40).optional(),
  vehicle_id: id.optional(),
});
const updateSchema = z.object({
  name: name.optional(),
  password: password.optional(),
  depot: id.optional(),
  outlet_id: id.optional(),
  district: z.string().trim().max(40).optional(),
  vehicle_id: id.optional(),
  active: z.boolean().optional(),
});

interface Member {
  id: string;
  username: string;
  name: string;
  role: "dispatcher" | "loader" | "driver" | "store";
  depot: string | null;
  outlet_id: string | null;
  district: string | null;
  vehicle_id: string | null;
  active: boolean;
  demo: boolean;
  created_at: string;
  created_by: string | null;
}

const list = () => sql<Member[]>`
  SELECT u.id, u.username, u.display_name AS name, u.role, u.depot, u.outlet_id, u.district, u.vehicle_id, u.active, u.is_demo AS demo,
         u.created_at, c.display_name AS created_by
  FROM users u LEFT JOIN users c ON c.id = u.created_by
  ORDER BY u.active DESC, array_position(ARRAY['dispatcher', 'loader', 'driver', 'store'], u.role), u.display_name`;

/** Check the work a role is tied to and return the columns to store. */
async function scopeFor(role: Member["role"], s: { depot?: string; outlet_id?: string; district?: string; vehicle_id?: string }) {
  if (role === "store") {
    // One store, or every store in a district (an area manager).
    if (s.district && !s.outlet_id) {
      const [d] = await sql`SELECT 1 FROM outlets WHERE district = ${s.district} LIMIT 1`;
      if (!d) throw new HttpError(400, "Choose the district this area manager covers.");
      return { depot: null, outlet_id: null, district: s.district, vehicle_id: null };
    }
    const [o] = await sql`SELECT 1 FROM outlets WHERE outlet_id = ${s.outlet_id ?? ""}`;
    if (!o) throw new HttpError(400, "Choose the store this manager runs, or a district.");
    return { depot: null, outlet_id: s.outlet_id!, district: null, vehicle_id: null };
  }
  if (role === "driver") {
    const [v] = await sql<{ depot: string }[]>`SELECT depot FROM vehicles WHERE vehicle_id = ${s.vehicle_id ?? ""}`;
    if (!v) throw new HttpError(400, "Choose the vehicle this driver drives.");
    return { depot: v.depot, outlet_id: null, district: null, vehicle_id: s.vehicle_id! };
  }
  const [d] = await sql`SELECT 1 FROM vehicles WHERE depot = ${s.depot ?? ""} LIMIT 1`;
  if (!d) throw new HttpError(400, "Choose the depot this person works at.");
  return { depot: s.depot!, outlet_id: null, district: null, vehicle_id: null };
}

/** Turn a unique-index clash into a message the dispatcher can act on. */
async function clash(e: unknown, vehicle: string | null): Promise<never> {
  const c = (e as { code?: string; constraint_name?: string }) ?? {};
  if (c.code === "23505" && c.constraint_name === "users_username_key") throw new HttpError(409, "That username is taken. Choose another.");
  if (c.code === "23505" && c.constraint_name === "users_one_driver_per_vehicle") {
    const [d] = await sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE role = 'driver' AND active AND vehicle_id = ${vehicle ?? ""}`;
    throw new HttpError(409, `${vehicle} already has a driver${d ? `: ${d.display_name}` : ""}. Deactivate that account or choose another vehicle.`);
  }
  throw e;
}

export function teamRoutes(app: FastifyInstance) {
  app.get("/api/team", async (req) => {
    await actor(req, ["dispatcher"]);
    return { people: await list() };
  });

  app.post("/api/team", async (req, reply) => {
    const who = await actor(req, ["dispatcher"]);
    const b = createSchema.parse(req.body);
    const scope = await scopeFor(b.role, b);
    const hash = await bcrypt.hash(b.password, 10);
    try {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO users (username, password_hash, role, display_name, depot, outlet_id, district, vehicle_id, created_by)
        VALUES (${b.username}, ${hash}, ${b.role}, ${b.name}, ${scope.depot}, ${scope.outlet_id}, ${scope.district}, ${scope.vehicle_id}, ${who.uid})
        RETURNING id`;
      reply.code(201);
      return { id: row.id, people: await list() };
    } catch (e) {
      return clash(e, scope.vehicle_id);
    }
  });

  app.post<{ Params: { id: string } }>("/api/team/:id", async (req) => {
    const who = await actor(req, ["dispatcher"]);
    const b = updateSchema.parse(req.body);
    const [u] = await sql<{ id: string; role: Member["role"]; is_demo: boolean; depot: string | null; outlet_id: string | null; district: string | null; vehicle_id: string | null }[]>`
      SELECT id, role, is_demo, depot, outlet_id, district, vehicle_id FROM users WHERE id::text = ${req.params.id}`;
    if (!u) throw new HttpError(404, "No such account.");
    if (u.is_demo) throw new HttpError(409, "The demo accounts stay as they are, so the walkthrough always works.");
    if (u.id === who.uid && b.active === false) throw new HttpError(409, "You can't deactivate your own account.");
    // A new store or district replaces the other (a manager covers one store or one district).
    const storeChange = b.outlet_id !== undefined || b.district !== undefined;
    const scope = b.depot !== undefined || storeChange || b.vehicle_id !== undefined
      ? await scopeFor(u.role, {
          depot: b.depot ?? u.depot ?? undefined,
          outlet_id: storeChange ? b.outlet_id || undefined : (u.outlet_id ?? undefined),
          district: storeChange ? b.district || undefined : (u.district ?? undefined),
          vehicle_id: b.vehicle_id ?? u.vehicle_id ?? undefined,
        })
      : { depot: u.depot, outlet_id: u.outlet_id, district: u.district, vehicle_id: u.vehicle_id };
    const hash = b.password ? await bcrypt.hash(b.password, 10) : null;
    try {
      await sql`
        UPDATE users SET
          display_name  = coalesce(${b.name ?? null}, display_name),
          password_hash = coalesce(${hash}, password_hash),
          depot = ${scope.depot}, outlet_id = ${scope.outlet_id}, district = ${scope.district}, vehicle_id = ${scope.vehicle_id},
          active = coalesce(${b.active ?? null}, active)
        WHERE id = ${u.id}`;
    } catch (e) {
      return clash(e, scope.vehicle_id);
    }
    return { people: await list() };
  });
}
