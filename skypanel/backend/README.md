# SkyPanel backend

FastAPI service that polls ADS-B, enriches it, and emits the semantic
`DisplayFrame` the LED panel renders.

```bash
uv venv --python 3.12 .venv
uv pip install -e ".[dev]"

python -m skypanel probe      # find your receiver's aircraft.json
python -m skypanel frame      # print one frame and exit
python -m skypanel serve      # http://localhost:8000
```

See [`../docs/BACKEND.md`](../docs/BACKEND.md) for the API surface and
[`../README.md`](../README.md) for the project as a whole.
