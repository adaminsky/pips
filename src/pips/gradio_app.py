"""
Gradio interface for the PIPS solver.

This module provides a lightweight alternative to the Socket.IO web
application defined in :mod:`pips.web_app`.  It exposes a Gradio Blocks
layout that lets users supply API keys (kept in Gradio state), paste a
problem description, and optionally upload an image.  The back-end uses
``PIPSSolver.solve`` so that the same automatic mode selection between
chain-of-thought and iterative coding is applied.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Iterator, Optional, Tuple

import threading
from queue import Queue, Empty
import copy
import os
import tempfile
import time

SAVED_RUNS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "saved_examples"))

try:
    import gradio as gr
    from gradio import update
except ImportError as exc:  # pragma: no cover - handled at runtime
    raise ImportError(
        "Gradio is required to run the PIPS Gradio app. "
        "Install it via `pip install gradio`."
    ) from exc

from pathlib import Path
import sys
path_root = Path(__file__).parents[2]
sys.path.append(str(path_root))

from src.pips.core import PIPSSolver
from src.pips.models import AVAILABLE_MODELS, get_model
from src.pips.utils import RawInput


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe(obj: Any) -> Any:
    """Best-effort conversion of solver logs into JSON-serialisable data."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_safe(x) for x in obj]
    return repr(obj)


def _resolve_api_key(model_id: str, keys: Dict[str, str]) -> Optional[str]:
    """Return the correct API key for a model based on its provider prefix."""
    if any(model_id.startswith(prefix) for prefix in ("gpt", "o3", "o4")):
        return keys.get("openai") or None
    if "gemini" in model_id:
        return keys.get("google") or None
    if "claude" in model_id:
        return keys.get("anthropic") or None
    return None


def _update_api_keys(openai_key: str, google_key: str, anthropic_key: str, state: Dict[str, str] | None):
    """Update the in-memory API key state."""
    new_state = dict(state or {})
    if openai_key.strip():
        new_state["openai"] = openai_key.strip()
    if google_key.strip():
        new_state["google"] = google_key.strip()
    if anthropic_key.strip():
        new_state["anthropic"] = anthropic_key.strip()
    message = "API keys updated in local session state."
    if not any([openai_key.strip(), google_key.strip(), anthropic_key.strip()]):
        message = "Cleared API keys from local session state."
        new_state = {}
    return new_state, message


PREPOPULATED_EXAMPLES: Dict[str, Dict[str, Any]] = {
    "iterative_coding": {
        "name": "Demo: Iterative Coding (Factorial)",
        "problem": "Calculate the factorial of 6 using Python code and explain the method.",
        "history": [
            {
                "role": "user",
                "content": "Calculate the factorial of 6 using Python code and explain the method.",
                "metadata": {"component": "user", "title": "User"},
            },
            {
                "role": "assistant",
                "content": (
                    "```json\n{\n  \"n\": 6\n}\n```\n\n"
                    "```python\ndef solve(symbols):\n    n = symbols['n']\n    result = 1\n    for i in range(2, n + 1):\n        result *= i\n    return result\n```"
                ),
                "metadata": {"component": "solver", "title": "🧠 Solver (iteration 0) · Demo Model"},
            },
            {
                "role": "assistant",
                "content": "Mode chosen: Iterative coding",
                "metadata": {"component": "mode_result", "title": "Mode Choice"},
            },
            {
                "role": "assistant",
                "content": "**Final Answer:** 720\n\n**Method:** Iterative coding",
                "metadata": {"component": "summary", "title": "Summary"},
            },
        ],
        "symbols": {"n": 6},
        "code": "def solve(symbols):\n    n = symbols['n']\n    result = 1\n    for i in range(2, n + 1):\n        result *= i\n    return result",
        "status": "Demo example: iterative coding (precomputed).",
    },
    "chain_of_thought": {
        "name": "Demo: Chain-of-Thought (Word Problem)",
        "problem": "John has 3 apples and buys 4 more. He then gives 2 to a friend. How many apples does he have now?",
        "history": [
            {
                "role": "user",
                "content": "John has 3 apples and buys 4 more. He then gives 2 to a friend. How many apples does he have now?",
                "metadata": {"component": "user", "title": "User"},
            },
            {
                "role": "assistant",
                "content": "John starts with 3 apples. After buying 4 more, he has 3 + 4 = 7 apples. Giving away 2 leaves 5 apples.",
                "metadata": {"component": "solver", "title": "🧠 Solver (reasoning)"},
            },
            {
                "role": "assistant",
                "content": "Mode chosen: Chain-of-thought reasoning",
                "metadata": {"component": "mode_result", "title": "Mode Choice"},
            },
            {
                "role": "assistant",
                "content": "**Final Answer:** 5\n\n**Method:** Chain-of-thought reasoning",
                "metadata": {"component": "summary", "title": "Summary"},
            },
        ],
        "symbols": None,
        "code": "",
        "status": "Demo example: chain-of-thought reasoning (precomputed).",
    },
}

# Override with streamlined demo definitions
PREPOPULATED_EXAMPLES = {
    "iterative_coding": {
        "name": "Demo: Iterative Coding (Factorial)",
        "problem": "Calculate the factorial of 6 using Python code and explain the method.",
        "history": [
            {
                "role": "user",
                "content": "Calculate the factorial of 6 using Python code and explain the method.",
                "metadata": {"component": "user", "title": "User"},
            },
            {
                "role": "assistant",
                "content": (
                    "```json\n{\n  \"n\": 6\n}\n```\n\n"
                    "```python\ndef solve(symbols):\n    n = symbols['n']\n    result = 1\n    for i in range(2, n + 1):\n        result *= i\n    return result\n```"
                ),
                "metadata": {"component": "solver", "title": "🧠 Solver (iteration 0) · Demo Model"},
            },
            {
                "role": "assistant",
                "content": "Mode chosen: Iterative coding",
                "metadata": {"component": "mode_result", "title": "Mode Choice"},
            },
            {
                "role": "assistant",
                "content": "**Final Answer:** 720\n\n**Method:** Iterative coding",
                "metadata": {"component": "summary", "title": "Summary"},
            },
        ],
        "symbols": {"n": 6},
        "code": "def solve(symbols):\n    n = symbols['n']\n    result = 1\n    for i in range(2, n + 1):\n        result *= i\n    return result",
        "status": "Demo example: iterative coding (precomputed).",
        "method": "Iterative coding",
        "decision": {"use_code": True},
    },
    "chain_of_thought": {
        "name": "Demo: Chain-of-Thought (Word Problem)",
        "problem": "John has 3 apples and buys 4 more. He then gives 2 to a friend. How many apples does he have now?",
        "history": [
            {
                "role": "user",
                "content": "John has 3 apples and buys 4 more. He then gives 2 to a friend. How many apples does he have now?",
                "metadata": {"component": "user", "title": "User"},
            },
            {
                "role": "assistant",
                "content": "John starts with 3 apples. After buying 4 more, he has 7 apples. Giving 2 away leaves 5 apples.",
                "metadata": {"component": "solver", "title": "🧠 Solver (reasoning)"},
            },
            {
                "role": "assistant",
                "content": "Mode chosen: Chain-of-thought reasoning",
                "metadata": {"component": "mode_result", "title": "Mode Choice"},
            },
            {
                "role": "assistant",
                "content": "**Final Answer:** 5\n\n**Method:** Chain-of-thought reasoning",
                "metadata": {"component": "summary", "title": "Summary"},
            },
        ],
        "symbols": None,
        "code": "",
        "status": "Demo example: chain-of-thought reasoning (precomputed).",
        "method": "Chain-of-thought reasoning",
        "decision": {"use_code": False},
    },
}


def _example_choices() -> list[tuple[str, str]]:
    choices = [(key, data["name"]) for key, data in PREPOPULATED_EXAMPLES.items()]
    choices.insert(0, ("", "Select a demo example"))
    return choices


def _saved_run_choices() -> list[tuple[str, str]]:
    """Return available saved run files as dropdown choices."""
    choices: list[tuple[str, str]] = [("", "Select a saved run")]
    if os.path.isdir(SAVED_RUNS_DIR):
        for name in sorted(os.listdir(SAVED_RUNS_DIR)):
            if name.lower().endswith(".json"):
                path = os.path.join(SAVED_RUNS_DIR, name)
                choices.append((name.split(".")[0], name))
    return choices


def _extract_problem_from_history(history: Any) -> str:
    """Take the first user message content from a conversation history."""
    if not isinstance(history, list):
        return ""
    for message in history:
        if isinstance(message, dict) and message.get("role") == "user":
            content = message.get("content")
            if isinstance(content, str):
                return content
    return ""


def _fill_example_problem(example_key: str):
    example = PREPOPULATED_EXAMPLES.get(example_key)
    if not example:
        return update()
    return update(value=example["problem"])


def _preview_example(example_key: str):
    example = PREPOPULATED_EXAMPLES.get(example_key)
    if not example:
        return update(), update(), update(), update(), update(value="Select a demo example to preview."), {}

    history = copy.deepcopy(example["history"])
    symbols = example.get("symbols")
    code = example.get("code", "")
    status = example.get("status", "Demo example")
    method = example.get("method", "")
    decision = example.get("decision")

    symbols_update = update(value=symbols, visible=symbols is not None)
    code_update = update(value=code, visible=bool(code))

    record = {
        "problem": example["problem"],
        "history": history,
        "symbols": _safe(symbols),
        "code": code,
        "status": status,
        "method": method,
        "decision": _safe(decision),
        "steps": [],
        "timestamp": time.time(),
    }

    status_update = update(value=status)

    return history, update(value=example["problem"]), symbols_update, code_update, status_update, record


def _load_saved_run(file_path: Optional[str]):
    """Load a saved solver run from a JSON export."""
    if file_path is None:
        raise gr.Error("Select a saved run first.")

    if isinstance(file_path, list):
        if not file_path:
            raise gr.Error("Select a saved run first.")
        file_path = file_path[0]

    if not isinstance(file_path, str):
        raise gr.Error("Invalid saved run selection.")

    file_path = file_path.strip()
    if not file_path:
        raise gr.Error("Select a saved run first.")

    abs_path = os.path.abspath(SAVED_RUNS_DIR + "/" + file_path)
    saved_dir = os.path.abspath(SAVED_RUNS_DIR)
    try:
        if os.path.commonpath([abs_path, saved_dir]) != saved_dir:
            raise gr.Error("Saved run must be located in the saved examples directory.")
    except ValueError as exc:  # pragma: no cover - platform dependent
        raise gr.Error("Saved run must be located in the saved examples directory.")

    if not os.path.isfile(abs_path):
        raise gr.Error(f"Saved run not found: {abs_path}")

    try:
        with open(abs_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError as exc:
        raise gr.Error(f"Could not read saved run: {abs_path}") from exc
    except json.JSONDecodeError as exc:
        raise gr.Error(f"Saved run is not valid JSON: {exc}") from exc
    except OSError as exc:  # pragma: no cover - depends on filesystem
        raise gr.Error(f"Failed to read saved run: {exc}") from exc

    history = data.get("history")
    if not isinstance(history, list):
        raise gr.Error("Saved run JSON must include a `history` list.")

    history_copy = copy.deepcopy(history)
    symbols = data.get("symbols")
    code = data.get("code", "")
    status = data.get("status", "Loaded saved run.")
    method = data.get("method", "")
    decision = data.get("decision")
    problem = _extract_problem_from_history(history_copy) or data.get("problem", "")
    steps = data.get("steps", [])
    timestamp = data.get("timestamp", time.time())

    symbols_visible = symbols is not None
    symbols_value = _safe(symbols) if symbols_visible else None
    symbols_update = update(value=symbols_value, visible=symbols_visible)

    code_visible = bool(code)
    code_update = update(value=code if code_visible else "", visible=code_visible)

    record = {
        "problem": problem,
        "history": history_copy,
        "symbols": _safe(symbols),
        "code": code,
        "status": status,
        "method": method,
        "decision": _safe(decision),
        "steps": _safe(steps),
        "timestamp": timestamp,
    }

    status_update = update(value=status)

    return (
        history_copy,
        update(value=problem),
        symbols_update,
        code_update,
        status_update,
        record,
    )


def _refresh_saved_runs():
    """Refresh saved run dropdown choices."""
    return update(choices=_saved_run_choices())


def _download_run(run_state: Optional[Dict[str, Any]]):
    if not run_state:
        raise gr.Error("Run the solver or preview a demo example first.")

    # fd, path = tempfile.mkstemp(prefix="pips_run_", suffix=".json")
    # save to saved_examples
    if not os.path.isdir(SAVED_RUNS_DIR):
        os.makedirs(SAVED_RUNS_DIR, exist_ok=True)
    path = os.path.join(SAVED_RUNS_DIR, f"pips_run_{int(time.time())}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(run_state, handle, indent=2)
    return update(value=path, visible=True)


def _stream_solver(
    problem_text: str,
    image,
    generator_model_id: str,
    critic_model_id: str,
    max_iterations: int,
    temperature: float,
    max_tokens: int,
    max_execution_time: int,
    api_keys_state: Dict[str, str] | None,
    previous_state: Optional[Dict[str, Any]] = None,
) -> Iterator[Tuple[list[Dict[str, Any]], Any, Any, Any, str, Optional[Dict[str, Any]]]]:
    """Stream solver progress to the Gradio Chatbot."""
    text = (problem_text or "").strip()
    last_state = previous_state

    if not text:
        history = [
            {
                "role": "assistant",
                "content": "❌ Please provide a problem statement before solving.",
                "metadata": {"component": "status", "title": "Status"},
            },
        ]
        status = "❌ Problem text missing."

        yield (
            history,
            update(),
            update(value=None, visible=False),
            update(value="", visible=False),
            status,
            last_state,
        )
        return

    keys = api_keys_state or {}
    generator_api_key = _resolve_api_key(generator_model_id, keys)
    critic_api_key = _resolve_api_key(critic_model_id, keys)

    history: list[Dict[str, Any]] = [
        {
            "role": "user",
            "content": text,
            "metadata": {"component": "user", "title": "User"},
        }
    ]
    symbols_output: Optional[Dict[str, Any]] = None
    code_output = ""
    status = "🔄 Preparing solver..."

    def emit(state_override: Optional[Dict[str, Any]] = None):
        nonlocal last_state
        if symbols_output is not None:
            symbols_update = update(value=symbols_output, visible=True)
            code_visible = bool(code_output)
            code_update = update(value=code_output if code_visible else "", visible=code_visible)
        else:
            symbols_update = update(value=None, visible=False)
            code_update = update(value="", visible=False)

        state_value = last_state
        if state_override is not None:
            last_state = state_override
            state_value = state_override

        return (
            history,
            update(),
            symbols_update,
            code_update,
            status,
            state_value,
        )

    yield emit()

    if not generator_api_key:
        error_msg = f"❌ Missing API key for generator model `{generator_model_id}`."
        status = error_msg
        symbols_output = None
        code_output = ""
        yield emit()
        return

    try:
        generator_model = get_model(generator_model_id, generator_api_key)
    except Exception as exc:  # pragma: no cover - depends on SDK
        error_msg = f"❌ Failed to initialise generator model `{generator_model_id}`: {exc}"
        status = error_msg
        symbols_output = None
        code_output = ""
        yield emit()
        return

    critic_model = generator_model
    if critic_model_id != generator_model_id and critic_api_key:
        try:
            critic_model = get_model(critic_model_id, critic_api_key)
        except Exception as exc:  # pragma: no cover
            error_msg = f"❌ Failed to initialise critic model `{critic_model_id}`: {exc}"
            status = error_msg
            symbols_output = None
            code_output = ""
            yield emit()
            return

    events: "Queue[Tuple[str, Any]]" = Queue()
    active_messages: Dict[Tuple[str, int], int] = {}
    last_status: Optional[str] = None
    mode_selection_index: Optional[int] = None

    def push(event: str, payload: Any):
        events.put((event, payload))

    steps: list[Dict[str, Any]] = []
    current_response: str = ""

    def on_step_update(step, message, iteration=None, prompt_details=None, **_):
        steps.append(
            {
                "step": step,
                "message": message,
                "iteration": iteration,
                "prompt_details": _safe(prompt_details),
            }
        )
        push("status", {"text": message, "step": step})

    def on_llm_streaming_start(iteration, model_name):
        push("solver_start", {"iteration": iteration, "model": model_name})

    def on_llm_streaming_token(token, iteration, model_name):
        push("solver_token", {"token": token, "iteration": iteration, "model": model_name})

    def on_llm_streaming_end(iteration, model_name):
        push("status", {"text": f"Completed solver response from {model_name} (iteration {iteration}).", "step": "solver_end"})

    def on_llm_reasoning_summary_token(token, iteration, model_name):
        push(
            "solver_reasoning_summary_token",
            {"token": token, "iteration": iteration, "model": model_name},
        )

    def on_llm_reasoning_summary_end(summary, iteration, model_name):
        push(
            "solver_reasoning_summary_end",
            {"summary": summary, "iteration": iteration, "model": model_name},
        )

    def on_code_check_streaming_start(iteration, model_name):
        push("critic_start", {"iteration": iteration, "model": model_name})

    def on_code_check_streaming_token(token, iteration, model_name):
        push("critic_token", {"token": token, "iteration": iteration, "model": model_name})

    def on_code_check_streaming_end(iteration, model_name):
        push("status", {"text": f"Completed critic feedback from {model_name} (iteration {iteration}).", "step": "critic_end"})

    callbacks = dict(
        on_step_update=on_step_update,
        on_llm_streaming_start=on_llm_streaming_start,
        on_llm_streaming_token=on_llm_streaming_token,
        on_llm_streaming_end=on_llm_streaming_end,
        on_llm_reasoning_summary_token=on_llm_reasoning_summary_token,
        on_llm_reasoning_summary_end=on_llm_reasoning_summary_end,
        on_code_check_streaming_start=on_code_check_streaming_start,
        on_code_check_streaming_token=on_code_check_streaming_token,
        on_code_check_streaming_end=on_code_check_streaming_end,
        check_interrupted=lambda: False,
        get_max_execution_time=lambda: max_execution_time,
    )

    solver = PIPSSolver(
        generator_model,
        max_iterations=max_iterations,
        temperature=temperature,
        max_tokens=max_tokens,
        interactive=False,
        critic_model=critic_model,
    )

    sample = RawInput(text_input=problem_text, image_input=image)

    def worker():
        try:
            answer, logs, decision = solver.solve(
                sample,
                stream=True,
                callbacks=callbacks,
                additional_rules="",
                decision_max_tokens=min(1024, max_tokens),
                interactive_requested=False,
            )
            events.put(("final", (answer, logs, decision)))
        except Exception as exc:  # pragma: no cover
            events.put(("error", str(exc)))
        finally:
            events.put(("done", None))

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    try:
        while True:
            event, payload = events.get()

            if event == "status":
                if isinstance(payload, dict):
                    text = payload.get("text") or ""
                    step_name = payload.get("step")
                else:
                    text = str(payload)
                    step_name = None

                status = text

                if step_name == "mode_selection":
                    if text:
                        history.append({
                            "role": "assistant",
                            "content": text,
                            "metadata": {"component": "mode_selection", "title": "Mode Selection"},
                        })
                        mode_selection_index = len(history) - 1
                    last_status = text
                    yield emit()
                else:
                    last_status = text
                    yield emit()

            elif event == "solver_start":
                iteration = payload.get("iteration")
                model = payload.get("model", "Solver")
                label = f"🧠 Solver (iteration {iteration}) · {model}"
                history.append({
                    "role": "assistant",
                    "content": "",
                    "metadata": {"component": "solver", "title": label},
                })
                idx = len(history) - 1
                active_messages[("solver", iteration)] = idx
                current_response = ""
                yield emit()

            elif event == "solver_token":
                iteration = payload.get("iteration")
                token = payload.get("token", "")
                model_name = payload.get("model", "Solver")
                idx = active_messages.get(("solver", iteration))
                if idx is not None:
                    entry = history[idx]
                    entry["content"] += token
                else:
                    entry = {
                        "role": "assistant",
                        "content": token,
                        "metadata": {"component": "solver", "title": f"🧠 Solver (iteration {iteration}) · {model_name}"},
                    }
                    history.append(entry)
                    idx = len(history) - 1
                    active_messages[("solver", iteration)] = idx
                current_response = history[idx]["content"]
                yield emit()

            elif event == "solver_reasoning_summary_token":
                iteration = payload.get("iteration")
                token = payload.get("token", "")
                model_name = payload.get("model", "Solver")
                key = ("reasoning_summary", iteration)
                idx = active_messages.get(key)
                if idx is not None:
                    history[idx]["content"] += token
                else:
                    entry = {
                        "role": "assistant",
                        "content": token,
                        "metadata": {"component": "reasoning_summary", "title": f"🧠 Reasoning Summary (iteration {iteration}) · {model_name}"},
                    }
                    history.append(entry)
                    idx = len(history) - 1
                    active_messages[key] = idx
                yield emit()

            elif event == "solver_reasoning_summary_end":
                iteration = payload.get("iteration")
                summary = payload.get("summary", "")
                model_name = payload.get("model", "Solver")
                key = ("reasoning_summary", iteration)
                idx = active_messages.get(key)
                summary_text = summary or ""
                if idx is not None:
                    if summary_text:
                        history[idx]["content"] = summary_text
                    else:
                        history[idx]["content"] = history[idx]["content"].strip()
                    active_messages.pop(key, None)
                elif summary_text:
                    history.append({
                        "role": "assistant",
                        "content": summary_text,
                        "metadata": {"component": "reasoning_summary", "title": f"🧠 Reasoning Summary (iteration {iteration}) · {model_name}"},
                    })
                yield emit()

            elif event == "critic_start":
                iteration = payload.get("iteration")
                model = payload.get("model", "Critic")
                label = f"🧾 Critic (iteration {iteration}) · {model}"
                history.append({
                    "role": "assistant",
                    "content": "",
                    "metadata": {"component": "critic", "title": label},
                })
                idx = len(history) - 1
                active_messages[("critic", iteration)] = idx
                yield emit()

            elif event == "critic_token":
                iteration = payload.get("iteration")
                token = payload.get("token", "")
                model_name = payload.get("model", "Critic")
                idx = active_messages.get(("critic", iteration))
                if idx is not None:
                    history[idx]["content"] += token
                else:
                    entry = {
                        "role": "assistant",
                        "content": token,
                        "metadata": {"component": "critic", "title": f"🧾 Critic (iteration {iteration}) · {model_name}"},
                    }
                    history.append(entry)
                    idx = len(history) - 1
                    active_messages[("critic", iteration)] = idx
                yield emit()

            elif event == "error":
                status = f"❌ Solver error: {payload}"
                history.append({
                    "role": "assistant",
                    "content": status,
                    "metadata": {"component": "error", "title": "Error"},
                })
                yield emit()

            elif event == "final":
                final_answer, logs, decision = payload

                if not isinstance(logs, dict) or logs is None:
                    logs = {}
                logs.setdefault("steps", steps)

                use_code = decision.get("use_code") if isinstance(decision, dict) else False

                symbols_output = None
                code_output = ""

                method_label = "Iterative coding" if use_code else "Chain-of-thought reasoning"

                if use_code:
                    symbols = logs.get("all_symbols") or []
                    programs = logs.get("all_programs") or []
                    if symbols:
                        symbols_output = _safe(symbols[-1])
                    if programs:
                        code_output = programs[-1] or ""
                    status = "✅ Completed (iterative coding)."
                else:
                    symbols_output = None
                    code_output = ""
                    status = "✅ Completed (chain-of-thought)."

                mode_choice_entry = {
                    "role": "assistant",
                    "content": f"Mode chosen: {method_label}",
                    "metadata": {"component": "mode_result", "title": "Mode Choice"},
                }
                if mode_selection_index is not None:
                    history.insert(mode_selection_index + 1, mode_choice_entry)
                else:
                    history.append(mode_choice_entry)

                summary_text = final_answer or ""
                if not summary_text:
                    summary_text = status
                summary_text = f"**Final Answer:** {summary_text}\n\n**Method:** {method_label}"
                history.append({
                    "role": "assistant",
                    "content": summary_text,
                    "metadata": {"component": "summary", "title": "Summary"},
                })

                run_record = {
                    "problem": text,
                    "history": copy.deepcopy(history),
                    "symbols": _safe(symbols_output),
                    "code": code_output,
                    "status": status,
                    "method": method_label,
                    "decision": _safe(decision),
                    "steps": _safe(steps),
                    "timestamp": time.time(),
                }

                yield emit(run_record)

            elif event == "done":
                break

    finally:
        # Drain any remaining events to avoid dangling threads.
        while True:
            try:
                events.get_nowait()
            except Empty:
                break


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def build_blocks() -> gr.Blocks:
    """Construct the Gradio Blocks layout."""
    with gr.Blocks() as demo:
        gr.Markdown(
            """
            ## PIPS
            Automatically chooses between chain-of-thought reasoning and program synthesis for each input.
            """
        )

        api_state = gr.State({})
        run_state = gr.State({})

        with gr.Row(equal_height=True):
            with gr.Column(scale=5):
                gr.Markdown("### API Keys")
                with gr.Row():
                    openai_key = gr.Textbox(label="OpenAI", type="password", placeholder="sk-...")
                    google_key = gr.Textbox(label="Google", type="password", placeholder="AIza...")
                    anthropic_key = gr.Textbox(label="Anthropic", type="password", placeholder="sk-ant-...")
                update_message = gr.Markdown("")
                update_btn = gr.Button("Save Keys", variant="secondary")
                update_btn.click(
                    fn=_update_api_keys,
                    inputs=[openai_key, google_key, anthropic_key, api_state],
                    outputs=[api_state, update_message],
                    queue=False,
                )

                # gr.Markdown("### Demo Examples")
                # example_dropdown = gr.Dropdown(
                #     choices=_example_choices(),
                #     value="",
                #     label="Choose a demo example",
                # )
                # with gr.Row():
                #     preview_btn = gr.Button("Preview Example", variant="secondary")

                gr.Markdown("### Examples")
                with gr.Row():
                    saved_run_dropdown = gr.Dropdown(
                        choices=_saved_run_choices(),
                        value="",
                        label="Example",
                        interactive=True,
                    )
                    # refresh_saved_runs_btn = gr.Button("Refresh", variant="secondary")
                load_btn = gr.Button("Load Example", variant="secondary")

                gr.Markdown("### Problem")
                problem = gr.Textbox(
                    label="Problem Description",
                    lines=10,
                    placeholder="Describe the task you want PIPS to solve.",
                )
                image = gr.Image(label="Optional Image", type="pil")

                gr.Markdown("### Models & Limits")
                generator_model = gr.Dropdown(
                    choices=list(AVAILABLE_MODELS.keys()),
                    value=next(iter(AVAILABLE_MODELS)),
                    label="Generator Model",
                    interactive=True,
                )
                critic_model = gr.Dropdown(
                    choices=list(AVAILABLE_MODELS.keys()),
                    value=next(iter(AVAILABLE_MODELS)),
                    label="Critic Model",
                    interactive=True,
                )

                with gr.Row():
                    max_iterations = gr.Slider(1, 15, value=8, step=1, label="Iterations")
                    temperature = gr.Slider(0.0, 2.0, value=0.0, step=0.1, label="Temperature")

                with gr.Row():
                    max_tokens = gr.Slider(512, 8192, value=4096, step=256, label="Max Tokens")
                    max_exec_time = gr.Slider(1, 60, value=10, step=1, label="Exec Timeout (s)")

                solve_button = gr.Button("Solve", variant="primary")

                status_md = gr.Markdown(value="Ready to solve.", label="Status")
                symbols_json = gr.JSON(label="Symbols (iterative coding)", visible=False)
                code_output = gr.Code(label="Final Program", language="python", visible=False)
                # download_btn = gr.Button("Download Last Run", variant="secondary")
                download_file = gr.File(label="Run Export", visible=False)

            with gr.Column(scale=7):
                chatbot = gr.Chatbot(
                    label="Solver Log",
                    type="messages",
                    height=550,
                )

        solve_button.click(
            fn=_stream_solver,
            inputs=[
                problem,
                image,
                generator_model,
                critic_model,
                max_iterations,
                temperature,
                max_tokens,
                max_exec_time,
                api_state,
                run_state,
            ],
            outputs=[chatbot, problem, symbols_json, code_output, status_md, run_state],
            queue=True,
        )

        # example_dropdown.change(
        #     fn=_fill_example_problem,
        #     inputs=[example_dropdown],
        #     outputs=[problem],
        # )

        # preview_btn.click(
        #     fn=_preview_example,
        #     inputs=[example_dropdown],
        #     outputs=[chatbot, problem, symbols_json, code_output, status_md, run_state],
        #     queue=False,
        # )

        load_btn.click(
            fn=_load_saved_run,
            inputs=[saved_run_dropdown],
            outputs=[chatbot, problem, symbols_json, code_output, status_md, run_state],
            queue=False,
        )

        # refresh_saved_runs_btn.click(
        #     fn=_refresh_saved_runs,
        #     outputs=[saved_run_dropdown],
        #     queue=False,
        # )

        # download_btn.click(
        #     fn=_download_run,
        #     inputs=[run_state],
        #     outputs=[download_file],
        #     queue=False,
        # )

    return demo


def launch(**kwargs):  # pragma: no cover - thin wrapper
    """Launch the Gradio interface."""
    return build_blocks().launch(**kwargs)


__all__ = ["build_blocks", "launch"]


if __name__ == "__main__":  # pragma: no cover
    launch()
