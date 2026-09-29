# Planning engine image. Build context: the repository root.
#   default command  → the queue worker
#   seed service     → migrations, then the one-shot seed job
FROM python:3.12-slim
WORKDIR /app
COPY services/engine/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/engine/routelanka_engine ./routelanka_engine
COPY services/engine/tests ./tests
COPY db/migrations ./db/migrations
ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "routelanka_engine.worker"]
