# Orateur

Minimal python local speech-to-text, text-to-speech and speech-to-speech assistant.

## Features

- **STT**: Whisper (pywhispercpp) for transcription
- **TTS**: Pocket TTS for text-to-speech
- **STS**: Speech-to-Speech (STT → Ollama/LLM → TTS)
- **MCP**: Tool providers via Model Context Protocol (Ollama uses them as function tools)
- **Shortcuts**: Global keyboard shortcuts (evdev)
- **Systemd**: Background service with pre-loaded models

## Installation

### From package manager (no uv required)

When installed via your distro (e.g. AUR), run setup once to create the venv and install GPU support:

```bash
orateur setup
```

### Development (with uv)

```bash
cd orateur
uv sync
```

## GPU acceleration (NVIDIA CUDA)

The default `pywhispercpp` wheel is CPU-only. Run setup to install a CUDA build for your GPU:

```bash
# Installed users
orateur setup

# Development
uv run orateur setup
```

Setup detects CUDA (via `nvcc` or `nvidia-smi`) and either builds pywhispercpp from source with GPU support (Linux x86_64) or installs the CPU wheel from PyPI.

Options:

```bash
orateur setup --backend auto   # default: detect CUDA
orateur setup --backend nvidia # force CUDA build (fails if no CUDA)
orateur setup --backend cpu    # PyPI CPU only
orateur setup --build-from-source  # force build from source (e.g. CUDA 13+ / Blackwell GPUs)
```

On non-Linux x86_64 or when CUDA is not detected, setup uses PyPI (CPU). GPU build may take several minutes.

## Usage

```bash
# Run main loop (used by systemd)
orateur run

# Transcribe
orateur transcribe

# Speech-to-Speech
orateur sts

# TTS from selection
orateur speak
```

For development, prefix with `uv run`:

```bash
uv run orateur run
uv run orateur transcribe
```

## Configuration

Config: `~/.config/orateur/config.json`

```bash
orateur config init
orateur config show
```

### MCP tools (Ollama)

MCP servers provide tools that Ollama can call during STS. Define them in `mcpServers` (stdio) and optionally `mcp_tools_url` (SSE). All tools are passed to the LLM; when it returns tool calls, they are executed via MCP and the results fed back.

```json
{
  "mcpServers": {
    "weather-forecast": {
      "command": "uvx",
      "args": ["weather-forecast-server"]
    }
  },
  "mcp_tools_url": "http://localhost:8050/sse"
}
```

- **mcpServers**: Named stdio servers with `command` and `args` (Cursor-compatible)
- **mcp_tools_url**: Optional SSE URL for an MCP tool server

List configured servers with `orateur mcp list`.

## Stopping

- **Ctrl+C** in the terminal stops `orateur run`
- If `kill <pid>` doesn't work: kill the Python process (the one with higher memory in `ps aux`), or use `pkill -f "orateur run"` to stop all
