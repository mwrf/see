"""FastAPI app: the device's endpoint, the settings UI, and the history dashboard."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from .config import Config, load_config
from .models import DisplayFrame
from .service import PanelService
from .settings import Settings

log = logging.getLogger(__name__)

WEB_DIR = Path(__file__).resolve().parent / "web"


def create_app(config: Config | None = None, *, service: PanelService | None = None) -> FastAPI:
    """Build the app. Tests pass a pre-wired `PanelService` with mock sources."""
    config = config or load_config()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        panel: PanelService = app.state.panel
        await panel.start()
        try:
            yield
        finally:
            await panel.aclose()

    app = FastAPI(title="SkyPanel", version="0.1.0", lifespan=lifespan)
    app.state.config = config
    app.state.panel = service or PanelService(config)

    def panel_of(request: Request) -> PanelService:
        return request.app.state.panel  # type: ignore[no-any-return]

    # ---------------------------------------------------------------- device

    @app.get("/api/frame", response_model=DisplayFrame)
    async def get_frame(request: Request) -> DisplayFrame:
        """What the panel polls. Answered from memory; the poll loop keeps it fresh."""
        return panel_of(request).current_frame()

    @app.get("/api/nearest")
    async def get_nearest(request: Request) -> dict[str, Any]:
        """The full enriched record behind the current frame, for debugging and the UI."""
        panel = panel_of(request)
        selected = panel.selected
        if selected is None:
            return {"aircraft": None, "source": panel.sources.active}
        return {
            "aircraft": asdict(selected.aircraft),
            "route": asdict(selected.route),
            "type_name": selected.type_name,
            "airline_colour": selected.airline_colour,
            "category": str(selected.traffic_category),
            "source": panel.sources.active,
        }

    @app.get("/api/aircraft")
    async def get_aircraft(request: Request) -> dict[str, Any]:
        """Everything currently in range — the map/list view in the web UI."""
        panel = panel_of(request)
        return {
            "source": panel.sources.active,
            "count": len(panel.last_aircraft),
            "aircraft": [asdict(ac) for ac in panel.last_aircraft],
        }

    # -------------------------------------------------------------- settings

    @app.get("/api/settings", response_model=Settings)
    async def get_settings(request: Request) -> Settings:
        return panel_of(request).settings

    @app.post("/api/settings", response_model=Settings)
    async def post_settings(
        request: Request, patch: dict[str, Any] = Body(default_factory=dict)
    ) -> Settings:
        """Partial update. The device picks the change up on its next poll."""
        panel = panel_of(request)
        try:
            updated = panel.settings_store.update(patch)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        panel.rebuild()
        return updated

    # -------------------------------------------------------------- tracking

    @app.post("/api/track")
    async def post_track(
        request: Request, body: dict[str, Any] = Body(default_factory=dict)
    ) -> dict[str, Any]:
        ident = str(body.get("ident", "")).strip().upper()
        if not ident:
            raise HTTPException(status_code=422, detail="ident is required")
        panel = panel_of(request)
        state = panel.start_tracking(ident)
        await panel.poll_once()
        return {"tracking": state.ident, "found": state.seen}

    @app.post("/api/track/cancel")
    async def post_track_cancel(request: Request) -> dict[str, Any]:
        panel = panel_of(request)
        panel.stop_tracking()
        await panel.poll_once()
        return {"tracking": None}

    # --------------------------------------------------------------- history

    @app.get("/api/history")
    async def get_history(
        request: Request, hours: float = Query(default=24.0, ge=0.1, le=720.0)
    ) -> dict[str, Any]:
        panel = panel_of(request)
        return {
            "summary": panel.history.summary(hours),
            "sightings": [asdict(s) for s in panel.history.recent(hours)],
        }

    # ---------------------------------------------------------------- health

    @app.get("/healthz")
    async def healthz(request: Request) -> JSONResponse:
        panel = panel_of(request)
        health = panel.health()
        code = 200 if health["status"] != "offline" else 503
        return JSONResponse(health, status_code=code)

    # ------------------------------------------------------------------- OTA

    @app.get("/firmware/manifest.json")
    async def firmware_manifest(request: Request) -> JSONResponse:
        """esp32FOTA manifest, served from the LAN so updates never leave the house."""
        path = request.app.state.config.server.firmware_manifest
        if not path or not Path(path).exists():
            raise HTTPException(status_code=404, detail="no firmware manifest configured")
        return JSONResponse(content=_read_json(Path(path)))

    # -------------------------------------------------------------------- UI

    @app.get("/", response_class=HTMLResponse)
    async def index() -> HTMLResponse:
        return _page("index.html")

    @app.get("/history", response_class=HTMLResponse)
    async def history_page() -> HTMLResponse:
        return _page("history.html")

    return app


def _page(name: str) -> HTMLResponse:
    path = WEB_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{name} not found")
    return HTMLResponse(path.read_text(encoding="utf-8"))


def _read_json(path: Path) -> Any:
    import json

    return json.loads(path.read_text(encoding="utf-8"))
