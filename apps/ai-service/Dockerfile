# Stage 1: Install dependencies using uv
FROM ghcr.io/astral-sh/uv:python3.12-trixie-slim AS builder
WORKDIR /app

# Install dependencies first (cached layer)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=apps/ai-service/uv.lock,target=uv.lock \
    --mount=type=bind,source=apps/ai-service/pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-editable --no-dev

# Copy project and sync
COPY apps/ai-service/ /app/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-editable --no-dev

# Stage 2: Production (minimal image)
FROM python:3.12-slim-trixie AS runner
WORKDIR /app
ENV PYTHONUNBUFFERED=1

RUN groupadd -g 1001 bytz && useradd -u 1001 -g bytz bytz

# Copy only the virtual environment (no source code needed with --no-editable)
COPY --from=builder --chown=bytz:bytz /app/.venv /app/.venv
COPY --chown=bytz:bytz apps/ai-service/ ./

ENV PATH="/app/.venv/bin:$PATH"
USER bytz
EXPOSE 3003
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3003"]
