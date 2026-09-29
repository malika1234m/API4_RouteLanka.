/**
 * Sign-in with the seeded accounts.
 *
 * The session is a signed JWT in an httpOnly cookie. It can hold one account per role, because judges
 * (and our demo) run several roles in tabs of one browser: the dispatcher on a laptop tab, the driver in
 * the phone preview. Each request names the role it acts as (`x-rl-role`), and the API accepts it only if
 * that role is signed in on this session.
 */
import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import type { Role } from "@routelanka/domain";
import { config } from "./config";
import { sql } from "./db";

export interface Account {
  uid: string;
  role: Role;
  name: string;
  username: string;
}

const key = new TextEncoder().encode(config.sessionSecret);
const COOKIE = "rl_session";
const ROLES: Role[] = ["dispatcher", "loader", "driver", "store"];

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readSession(req: FastifyRequest): Promise<Account[]> {
  const token = req.cookies[COOKIE];
  if (!token) return [];
  try {
    const { payload } = await jwtVerify(token, key);
    return (payload.accounts as Account[]) ?? [];
  } catch {
    return [];
  }
}

async function writeSession(reply: FastifyReply, accounts: Account[]) {
  const token = await new SignJWT({ accounts }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(key);
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/", maxAge: 12 * 3600 });
}

export async function login(req: FastifyRequest, reply: FastifyReply, username: string, password: string): Promise<Account> {
  const [u] = await sql<{ id: string; role: Role; display_name: string; username: string; password_hash: string }[]>`
    SELECT id, role, display_name, username, password_hash FROM users WHERE username = ${username.trim().toLowerCase()}`;
  // Compare even when the user doesn't exist, so response time doesn't reveal valid usernames.
  const ok = await bcrypt.compare(password, u?.password_hash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
  if (!u || !ok) throw new HttpError(401, "That username and password don't match an account.");
  const account: Account = { uid: u.id, role: u.role, name: u.display_name, username: u.username };
  const accounts = (await readSession(req)).filter((a) => a.role !== account.role);
  await writeSession(reply, [...accounts, account]);
  return account;
}

export function logout(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: "/" });
}

export async function accounts(req: FastifyRequest): Promise<Account[]> {
  return readSession(req);
}

/** The account the request acts as. The role comes from the `x-rl-role` header and must be signed in. */
export async function actor(req: FastifyRequest, allowed?: Role[]): Promise<Account> {
  const signedIn = await readSession(req);
  if (!signedIn.length) throw new HttpError(401, "Sign in first.");
  const want = req.headers["x-rl-role"] as Role | undefined;
  const acting = want ? signedIn.find((a) => a.role === want) : signedIn.length === 1 ? signedIn[0] : undefined;
  if (!acting) throw new HttpError(403, want && ROLES.includes(want) ? `Sign in as the ${want} to do this.` : "Choose a role.");
  if (allowed && !allowed.includes(acting.role)) throw new HttpError(403, `The ${acting.role} can't do this.`);
  return acting;
}
