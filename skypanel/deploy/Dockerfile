# SkyPanel backend image.
#
# Built for arm64/armv7 as well as amd64: the natural home for this is the same
# Pi that runs the ADS-B decoder.

FROM python:3.12-slim AS build

# uv resolves and installs an order of magnitude faster than pip on a Pi.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /src
COPY backend/pyproject.toml backend/README.md ./
COPY backend/skypanel ./skypanel
# force-include in pyproject copies these into the wheel as skypanel/data.
COPY backend/data ./data

RUN uv venv /opt/skypanel/.venv \
    && VIRTUAL_ENV=/opt/skypanel/.venv uv pip install --no-cache .


FROM python:3.12-slim

RUN useradd --system --create-home --home-dir /var/lib/skypanel skypanel

COPY --from=build /opt/skypanel/.venv /opt/skypanel/.venv
# data files ship inside the wheel (see pyproject force-include)

WORKDIR /opt/skypanel
ENV PATH="/opt/skypanel/.venv/bin:$PATH" \
    SKYPANEL_STATE_DIR=/state \
    PYTHONUNBUFFERED=1

RUN mkdir -p /state /config && chown skypanel:skypanel /state
USER skypanel

EXPOSE 8000
CMD ["python", "-m", "skypanel", "serve"]
