<h1 align="center">PIPS: Per-Instance Program Synthesis</h1>

<p align="center">
  <img src="assets/pips_overview.png" width="800">
</p>

<div align="center">
<a href="https://huggingface.co/spaces/steinad/PIPS-demo">
<img alt="Static Badge" src="https://img.shields.io/badge/Demo-PIPS-blue?style=flat&logo=huggingface&link=https%3A%2F%2Fhuggingface.co%2Fspaces%2Fsteinad%2FPIPS-demo">
</a>
<img alt="Static Badge" src="https://img.shields.io/badge/License-MIT-yellow?style=flat&link=https%3A%2F%2Fopensource.org%2Flicenses%2FMIT">
</div>


Per-Instance Program Synthesis (PIPS) is an adaptive reasoning baseline that decides, for every problem instance, whether to run deliberate chain-of-thought reasoning or synthesize executable Python code.

## News

- **[10/26/2025]** Code for PIPS as well as a Gradio demo are released.
- **[09/18/2025]** PIPS accepted to NeurIPS 2025!

## Why try PIPS?
- Adaptive per-instance strategy selection that balances executable program synthesis with fast chain-of-thought reasoning.
- Iterative code refinement with automatic execution, error recovery, and optional interactive callbacks.
- Works out-of-the-box as a Python library and ships with a lightweight Gradio UI for quick exploration.
- Drop-in baseline: import a single class to embed Per-Instance Program Synthesis inside your stack.

## Install with uv
```bash
git clone <repository-url>
cd PIPS
uv venv
source .venv/bin/activate
uv sync --editable .
```

To include optional dependencies:
- `uv sync --group gradio` enables the browser UI.
- `uv sync --group dev` installs linting and test tooling.

Install multiple groups at once with `uv sync --group gradio --group dev`.

## Configure providers
Export whichever API keys you plan to use:
```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GOOGLE_API_KEY="..."
```
Only one key is required to get started.

## Use PIPS from Python
```python
from pips import PIPSSolver, get_model
from pips.utils import RawInput

model = get_model("gpt-4o", api_key="your-openai-api-key")
solver = PIPSSolver(model=model, max_iterations=8, temperature=0.0)

problem = RawInput(text_input="What is the sum of the first 10 prime numbers?")
answer, telemetry, mode_decision = solver.solve(problem, stream=False)
print("Answer:", answer)

# Inspect the selected mode
print("Mode:", "code" if mode_decision["use_code"] else "chain-of-thought")
```
Set `stream=True` and pass callbacks such as `on_llm_streaming_token` or
`on_step_update` to receive incremental updates. For complete control you can
call `solve_with_code` or `solve_chain_of_thought` directly, and the same
callbacks work for both.

## Run the Gradio App
Install the Gradio extra and launch the browser experience:
```bash
uv sync --group gradio
uv run python -m pips.gradio_app
```

## Supported providers
PIPS supports any OpenAI, Anthropic, or Google model through their API
endpoints. Models hosted with VLLM are also supported.

## Development and tests
Install dev tooling and run the test suite:
```bash
uv sync --group dev
uv run pytest
```

## License
MIT
