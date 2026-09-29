"""Planning engine worker: consumes `plan.propose` commands from RabbitMQ.

For each request it loads the day's orders and fleet, runs the engine, and in one transaction replaces
the draft plan, marks the job done and appends a `plan.proposed` event to the outbox. The API's outbox
relay publishes that event, so every open plan board refreshes.

Delivery guarantees:
  - the message is acknowledged only after the transaction commits;
  - a redelivered command is detected through processed_messages and acknowledged without re-running;
  - a command that fails is rejected without requeue and goes to the dead-letter queue.
"""
import json
import os
import time
import traceback

import pika
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .planning import propose

CONSUMER = "engine"
COMMANDS, DLX = "routelanka.commands", "routelanka.dlx"
QUEUE = "engine.plan"


def log(*a):
    print("[engine]", *a, flush=True)


def demo_time(ws: dict) -> str:
    """The demo clock: 03:00 at clock_start, running clock_speed times real time."""
    mins = 180 + int((time.time() - ws["clock_start"].timestamp()) / 60 * ws["clock_speed"])
    return f"{mins // 60 % 24:02d}:{mins % 60:02d}"


def load_day(cur, workspace_id):
    cur.execute("SELECT * FROM workspaces WHERE id = %s", [workspace_id])
    ws = cur.fetchone()
    cur.execute("""SELECT o.order_ref, o.outlet_id, o.brand, o.district, o.depot, o.temp_requirement, o.order_units::int,
                          o.order_weight_kg::float, o.order_volume_m3::float, o.deferred_yesterday::int, o.days_since_last_served::int,
                          t.dock_type, t.parking_constraint, t.mall_window, t.window_open_time, t.window_close_time
                   FROM orders o JOIN outlets t USING (outlet_id)
                   WHERE o.workspace_id = %s AND o.run_date = %s""", [workspace_id, ws["service_date"]])
    orders = cur.fetchall()
    cur.execute("""SELECT v.vehicle_id, v.type, v.temp, v.weight_cap_kg::float, v.volume_cap_m3::float, v.km_per_l::float,
                          v.weekly_fuel_quota_l::float, v.depot, d.status, d.fuel_used_l::float
                   FROM vehicles v JOIN vehicle_day d USING (vehicle_id) WHERE d.workspace_id = %s""", [workspace_id])
    vehicles = cur.fetchall()
    cur.execute("SELECT * FROM districts")
    dtravel = {r["district"]: {k: float(v) if k not in ("district", "depot", "road_class") else v for k, v in r.items()} for r in cur.fetchall()}
    cur.execute("SELECT brand, dock_type, minutes::float FROM service_allowance")
    allow = {(r["brand"], r["dock_type"]): r["minutes"] for r in cur.fetchall()}
    cur.execute("SELECT value FROM engine_params WHERE key = 'predictions'")
    params = cur.fetchone()["value"]
    cur.execute("SELECT monsoon FROM calendar WHERE date = %s", [ws["service_date"]])
    row = cur.fetchone()
    return ws, orders, vehicles, dtravel, allow, params, bool(row and row["monsoon"])


def handle(conn, msg: dict):
    job_id, workspace_id = msg["job_id"], msg["workspace_id"]
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        cur.execute("INSERT INTO processed_messages (consumer, event_id) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING 1", [CONSUMER, job_id])
        if cur.fetchone() is None:
            log("duplicate command, already handled:", job_id)
            return
        ws, orders, vehicles, dtravel, allow, params, monsoon = load_day(cur, workspace_id)
        if ws["published"]:
            cur.execute("UPDATE plan_jobs SET status='failed', finished_at=now(), error='plan already published' WHERE id=%s", [job_id])
            return
        cur.execute("UPDATE plan_jobs SET status='running' WHERE id=%s", [job_id])
        started = time.perf_counter()
        assignments, trips = propose(orders, vehicles, dtravel, allow, params, monsoon)
        ms = round((time.perf_counter() - started) * 1000)

        cur.execute("DELETE FROM assignments WHERE workspace_id = %s", [workspace_id])
        cur.execute("DELETE FROM trips WHERE workspace_id = %s", [workspace_id])
        cols = ["decision", "reason", "vehicle_id", "trip_id", "stop_seq", "plan_arrival", "pred_arrival", "pred_window", "pred_service_min", "pred_late_prob", "priority"]
        cur.executemany(f"INSERT INTO assignments (workspace_id, order_ref, {', '.join(cols)}) VALUES (%s, %s, {', '.join(['%s'] * len(cols))})",
                        [[workspace_id, a["order_ref"], *[a.get(c) for c in cols]] for a in assignments])
        tcols = ["vehicle_id", "trip_id", "brand", "district", "depot", "depart", "minutes", "km", "fuel_l"]
        cur.executemany(f"INSERT INTO trips (workspace_id, {', '.join(tcols)}) VALUES (%s, {', '.join(['%s'] * len(tcols))})",
                        [[workspace_id, *[t[c] for c in tcols]] for t in trips])
        served = sum(a["decision"] == "served" for a in assignments)
        summary = dict(orders=len(orders), served=served, deferred=len(orders) - served, trips=len(trips), ms=ms)
        cur.execute("UPDATE plan_jobs SET status='done', finished_at=now(), summary=%s WHERE id=%s", [Jsonb(summary), job_id])
        cur.execute("""INSERT INTO events (workspace_id, type, actor_role, text, kind, payload, at)
                       VALUES (%s, 'plan.proposed', 'dispatcher', %s, 'decision', %s, %s)""",
                    [workspace_id, f"Planner proposed a new plan: {served} orders on {len(trips)} trips, {len(orders) - served} deferred with reasons ({ms} ms)",
                     Jsonb(dict(job_id=job_id, **summary)), demo_time(ws)])
        log(f"job {job_id}: {summary}")


def main():
    url = os.environ["DATABASE_URL"]
    params = pika.URLParameters(os.environ.get("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/"))
    params.heartbeat = 60
    while True:
        try:
            with psycopg.connect(url, autocommit=True) as conn:
                connection = pika.BlockingConnection(params)
                ch = connection.channel()
                ch.exchange_declare(COMMANDS, "direct", durable=True)
                ch.exchange_declare(DLX, "topic", durable=True)
                ch.queue_declare(QUEUE, durable=True, arguments={"x-dead-letter-exchange": DLX, "x-dead-letter-routing-key": "engine.plan.dead"})
                ch.queue_bind(QUEUE, COMMANDS, "plan.propose")
                ch.queue_declare("engine.plan.dead", durable=True)
                ch.queue_bind("engine.plan.dead", DLX, "engine.plan.dead")
                ch.basic_qos(prefetch_count=1)

                def on_message(channel, method, _props, body):
                    try:
                        handle(conn, json.loads(body))
                        channel.basic_ack(method.delivery_tag)
                    except Exception:
                        traceback.print_exc()
                        channel.basic_nack(method.delivery_tag, requeue=False)  # → dead-letter queue

                ch.basic_consume(QUEUE, on_message)
                log("waiting for plan requests on", QUEUE)
                ch.start_consuming()
        except (pika.exceptions.AMQPConnectionError, psycopg.OperationalError) as e:
            log("connection lost, retrying in 3 s:", e)
            time.sleep(3)


if __name__ == "__main__":
    main()
