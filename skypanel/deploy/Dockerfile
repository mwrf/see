# Backend only. The firmware is flashed over USB and the emulator is a desktop tool;
# neither belongs in a container that runs on a Pi.

FROM python:3.12-slim AS build

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Dependencies first, so a code change doesn't re-resolve the lockfile.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY backend/ ./
RUN uv sync --frozen --no-dev


FROM python:3.12-slim

RUN useradd --system --uid 10001 --home /var/lib/skypanel --create-home skypanel

WORKDIR /app
COPY --from=build --chown=skypanel:skypanel /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    SKYPANEL_STATE_DIR=/var/lib/skypanel \
    SKYPANEL_HOST=0.0.0.0 \
    SKYPANEL_PORT=8000

USER skypanel
VOLUME ["/var/lib/skypanel"]
EXPOSE 8000

# The panel must never be left showing a stale frame because the process wedged.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; \
        sys.exit(0 if urllib.request.urlopen('http://localhost:8000/healthz', timeout=4).status == 200 else 1)"

CMD ["skypanel-serve"]
