import sys
from pathlib import Path
from types import SimpleNamespace

# Ensure the src directory is importable without installing the package
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

# Provide a lightweight stub for the openai dependency if it is unavailable.
if "openai" not in sys.modules:
    class _OpenAIStubClient:
        def __init__(self, *args, **kwargs):
            self.responses = SimpleNamespace(create=lambda **_: None)

    sys.modules["openai"] = SimpleNamespace(OpenAI=_OpenAIStubClient)

from pips import PIPSSolver  # noqa: E402
from pips.utils import RawInput  # noqa: E402


class FakeModel:
    """Minimal in-memory LLM stub that returns queued responses."""

    class _Output:
        def __init__(self, text, reasoning_summary=None):
            self.text = text
            self.reasoning_summary = reasoning_summary

    class _Response:
        def __init__(self, text, reasoning_summary=None):
            self.outputs = [FakeModel._Output(text, reasoning_summary)]

    def __init__(self, responses):
        self._responses = list(responses)
        self.prompts = []

    def chat(self, prompt, sampling_params=None, use_tqdm=False):  # pragma: no cover - exercised via solver
        self.prompts.append(prompt)
        if not self._responses:
            raise AssertionError("FakeModel.chat called more times than responses provided.")

        response = self._responses.pop(0)
        if callable(response):
            response = response(prompt)
        return [FakeModel._Response(response)]


def test_solve_chain_of_thought_returns_final_answer_and_logs():
    responses = [
        "analysis\nFINAL ANSWER: [0.0, 0.1, 0.2, 0.0, 0.1, 0.0, 0.1, 0.0, 0.1, 0.0]",
        "Thoughts...\nFINAL ANSWER: 42",
    ]
    solver = PIPSSolver(model=FakeModel(responses), max_iterations=0, temperature=0.0)
    sample = RawInput(text_input="What is 6 * 7?", image_input=None)

    final_answer, logs, mode_decision = solver.solve(sample, stream=False)

    assert final_answer == "FINAL ANSWER: 42"
    assert logs["final_answer"] == "42"
    assert mode_decision["use_code"] is False


def test_solve_with_code_executes_program_and_returns_result():
    mode_selection = "analysis\nFINAL ANSWER: [0.9, 0.8, 0.7, 0.9, 0.8, 0.9, 0.8, 0.7, 0.9, 0.8]"
    program_response = (
        "```json\n"
        "{\n"
        '  "numbers": [1, 2]\n'
        "}\n"
        "```\n"
        "\n"
        "```python\n"
        "def solve(symbols):\n"
        "    return sum(symbols[\"numbers\"])\n"
        "```\n"
    )
    solver = PIPSSolver(model=FakeModel([mode_selection, program_response]), max_iterations=0, temperature=0.0)
    sample = RawInput(text_input="Add the numbers 1 and 2.", image_input=None)

    final_answer, logs, mode_decision = solver.solve(sample, stream=False)

    assert mode_decision["use_code"] is True
    assert final_answer == "FINAL ANSWER: 3"
    execution = logs["execution_results"][0]
    assert str(execution["output"]) == "3"
    assert logs["all_programs"][0].strip().startswith("def solve")
