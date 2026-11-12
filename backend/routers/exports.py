"""Research reports: the figures, the tables behind them, and the reproduction report.

A research router. Every download is matched against a catalogue built from the record; a name
that arrives on a request is never used to build a path.
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from backend.services import exports as service
from backend.services.errors import NotFoundError

router = APIRouter(prefix="/api/exports", tags=["research reports"])

Name = Query(max_length=80, pattern=r"^[A-Za-z0-9_.\-]{1,80}$")


@router.get("/figures")
async def figures() -> Dict[str, Any]:
    """The thesis figure set, with the caption recorded beside each figure."""
    return await run_in_threadpool(service.figures)


@router.get("/figure")
async def figure(name: str = Name, format: str = Query(default="png", pattern=r"^(png|pdf)$")) -> Response:
    """One figure, by a name that must appear in the catalogue."""
    try:
        content, media_type, filename = await run_in_threadpool(service.figure_file, name, format)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/tables")
async def tables() -> Dict[str, Any]:
    return await run_in_threadpool(service.tables)


@router.get("/table")
async def table(name: str = Name) -> Response:
    """One table as CSV, written out of the record at the moment it is asked for."""
    try:
        content, filename = await run_in_threadpool(service.table_csv, name)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(content=content, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/reproduction-report")
async def reproduction_report() -> Dict[str, Any]:
    try:
        return await run_in_threadpool(service.reproduction_report)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
