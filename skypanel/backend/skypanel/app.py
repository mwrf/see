"""FastAPI application: the device endpoint, the settings UI and the dashboard.

The device only ever calls ``GET /api/frame``.  Everything else exists for
humans and for debugging.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from . import __version__
from .colours import default_registry as default_airlines
from .service import SkyPanelService
from .settings import AppConfig, SettingsError
from .sources.aggregator import PROVIDERS
from .web import DASHBOARD_HTML, SETTINGS_HTML

log = logging.getLogger(__name__)


def create_app(service: SkyPanelService | None = None, config: AppConfig | None = None) -> FastAPI:
    """Build the app.

    Passing a pre-built ``service`` is how the tests get a fully mocked stack
    without touching the network or the filesystem.
    """
    resolved_config = config or (service.config if service else AppConfig.load())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.service = service or SkyPanelService(resolved_config)
        await app.state.service.start()
        try:
            yield
        finally:
            await app.state.service.aclose()

    app = FastAPI(title="SkyPanel", version=__version__, lifespan=lifespan)
    if service is not None:
        app.state.service = service

    def svc(request: Request) -> SkyPanelService:
        instance = getattr(request.app.state, "service", None)
        if instance is None:  # pragma: no cover - lifespan always sets it
            raise HTTPException(status_code=503, detail="service not started")
        return instance  # type: ignore[no-any-return]

    # -- the device endpoint --------------------------------------------

    @app.get("/api/frame")
    async def api_frame(request: Request) -> JSONResponse:
        """What the panel polls.  Never 500s: an error is itself a frame."""
        frame = await svc(request).current_frame()
        return JSONResponse(frame.to_json(), headers={"Cache-Control": "no-store"})

    # -- introspection ---------------------------------------------------

    @app.get("/api/nearest")
    async def api_nearest(request: Request) -> JSONResponse:
        service_ = svc(request)
        await service_.current_frame()
        if service_.last_enriched is None:
            return JSONResponse({"aircraft": None, "source": service_.manager.active_name})
        return JSONResponse(
            {"aircraft": service_.last_enriched.to_json(), "source": service_.manager.active_name}
        )

    @app.get("/api/aircraft")
    async def api_aircraft(request: Request) -> JSONResponse:
        """Everything currently in range, nearest first -- useful for the UI map."""
        service_ = svc(request)
        await service_.poll()
        from .geo import within_radius

        in_range = within_radius(
            service_.last_aircraft,
            service_.settings.home_lat,
            service_.settings.home_lon,
            service_.settings.scan_radius_mi,
        )
        return JSONResponse(
            {
                "source": service_.manager.active_name,
                "count": len(in_range),
                "aircraft": [
                    {
                        "hex": ac.hex,
                        "callsign": ac.callsign,
                        "lat": ac.lat,
                        "lon": ac.lon,
                        "alt_baro_ft": ac.alt_baro_ft,
                        "gs_kt": ac.gs_kt,
                        "track_deg": ac.track_deg,
                        "distance_mi": round(distance, 2),
                    }
                    for ac, distance in in_range
                ],
            }
        )

    # -- settings --------------------------------------------------------

    @app.get("/api/settings")
    async def get_settings(request: Request) -> JSONResponse:
        service_ = svc(request)
        return JSONResponse(
            {
                "settings": service_.settings.to_json(),
                "meta": {
                    "providers": {key: p.label for key, p in PROVIDERS.items()},
                    "source_mode": service_.config.source.mode,
                    "active_source": service_.manager.active_name,
                    "attribution": service_.attribution(),
                    "airlines_known": len(service_.airlines),
                    "airports_known": len(service_.airports),
                    "version": __version__,
                },
            }
        )

    @app.post("/api/settings")
    async def post_settings(request: Request) -> JSONResponse:
        service_ = svc(request)
        updates = await _read_body(request)
        try:
            updated = service_.update_settings(updates)
        except SettingsError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return JSONResponse({"settings": updated.to_json()})

    # -- tracking --------------------------------------------------------

    @app.post("/api/track")
    async def post_track(request: Request) -> JSONResponse:
        service_ = svc(request)
        body = await _read_body(request)
        ident = str(body.get("ident", "")).strip()
        if not ident:
            raise HTTPException(status_code=400, detail="ident is required")
        session = service_.start_tracking(ident)
        return JSONResponse({"tracking": session.to_json()})

    @app.post("/api/track/cancel")
    async def post_track_cancel(request: Request) -> JSONResponse:
        return JSONResponse({"tracking": None, "was_tracking": svc(request).cancel_tracking()})

    # -- history ---------------------------------------------------------

    @app.get("/api/history")
    async def api_history(request: Request, hours: float = 24.0) -> JSONResponse:
        service_ = svc(request)
        hours = max(0.1, min(24.0 * 30, hours))
        return JSONResponse(
            {
                "hours": hours,
                "summary": service_.history.summary(hours),
                "sightings": service_.history.recent(hours),
            }
        )

    # -- health ----------------------------------------------------------

    @app.get("/healthz")
    async def healthz(request: Request) -> JSONResponse:
        health = svc(request).health()
        return JSONResponse(health, status_code=200 if health["ok"] else 503)

    # -- OTA manifest ----------------------------------------------------

    @app.get("/api/firmware/manifest.json")
    async def firmware_manifest(request: Request) -> JSONResponse:
        """esp32FOTA manifest, so updates stay on the LAN."""
        service_ = svc(request)
        directory = Path(service_.config.server.firmware_dir).expanduser()
        manifest = directory / "manifest.json"
        if not manifest.exists():
            return JSONResponse({"type": "skypanel", "version": __version__, "url": None})
        try:
            return JSONResponse(json.loads(manifest.read_text()))
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=500, detail=f"bad firmware manifest: {exc}") from exc

    @app.get("/firmware/{filename}")
    async def firmware_binary(request: Request, filename: str) -> Response:
        """Serve a published firmware image to esp32FOTA."""
        service_ = svc(request)
        directory = Path(service_.config.server.firmware_dir).expanduser().resolve()
        candidate = (directory / filename).resolve()
        #  Refuse anything that escapes the release directory; the device is on
        #  the LAN, but so is everything else on the LAN.
        if not candidate.is_file() or directory not in candidate.parents:
            raise HTTPException(status_code=404, detail="no such firmware image")
        return Response(
            candidate.read_bytes(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{candidate.name}"'},
        )

    # -- pages -----------------------------------------------------------

    @app.get("/", response_class=HTMLResponse)
    async def index() -> Response:
        return HTMLResponse(SETTINGS_HTML)

    @app.get("/dashboard", response_class=HTMLResponse)
    async def dashboard() -> Response:
        return HTMLResponse(DASHBOARD_HTML)

    @app.get("/api/airlines")
    async def api_airlines() -> JSONResponse:
        registry = default_airlines()
        entries = [registry.get(code) for code in registry.codes()]
        return JSONResponse(
            {
                "count": len(registry),
                "airlines": [entry.to_json() for entry in entries if entry is not None],
            }
        )

    return app


async def _read_body(request: Request) -> dict[str, Any]:
    """Accept JSON or an HTML form post, because the settings page uses both."""
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="body must be valid JSON") from exc
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body must be a JSON object")
        return body
    form = await request.form()
    return {key: value for key, value in form.items() if isinstance(value, str)}
