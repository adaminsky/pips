"""
Flask-SocketIO server for the Per-Instance Program Synthesis (PIPS) front-end.

Matches the JS events used in index.html:
    • session_connected
    • settings_updated
    • solving_started / step_update / llm_streaming_* / code_execution_* / code_check
    • solving_complete / solving_error / solving_interrupted
    • heartbeat_response
    • download_chat_log
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime
from typing import Any, Dict

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

# ─── project modules ────────────────────────────────────────────────────────────
from .models import AVAILABLE_MODELS, get_model
from .core   import PIPSSolver, PIPSMode
from .utils  import RawInput, base642img
# ────────────────────────────────────────────────────────────────────────────────

# ---------------------------------------------------------------------
# basic app setup
# ---------------------------------------------------------------------
app = Flask(__name__, template_folder="templates")
app.config["SECRET_KEY"] = "change-me"         # ← customise for prod
socketio = SocketIO(app, cors_allowed_origins="*")

# ---------------------------------------------------------------------
# server-side session state
# ---------------------------------------------------------------------
DEFAULT_SETTINGS = dict(
    model               = next(iter(AVAILABLE_MODELS)),  # first model id
    openai_api_key      = "",
    google_api_key      = "",
    anthropic_api_key   = "",
    max_iterations      = 8,
    temperature         = 0.0,
    max_tokens          = 4096,
    max_execution_time  = 10,
    # New interactive mode settings
    pips_mode           = "AGENT",                       # or "INTERACTIVE"
    generator_model     = next(iter(AVAILABLE_MODELS)),  # can be different from critic
    critic_model        = next(iter(AVAILABLE_MODELS)),  # can be different from generator
    custom_rules        = "",                            # textarea value
    prompt_overrides    = {},                            # persisted user edits keyed by prompt-id
)

sessions: Dict[str, Dict[str, Any]] = {}
active_tasks: Dict[str, Dict[str, Any]] = {}

def _safe(obj):
    """JSON-serialise anything (fractions etc. become strings)."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, list):
        return [_safe(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _safe(v) for k, v in obj.items()}
    return str(obj)


def make_callbacks(sid: str, generator_model_name: str, critic_model_name: str, stop_evt: threading.Event, max_exec: int):
    """Build the callbacks dict required by PIPSSolver (stream=True)."""

    def _emit(event: str, payload: dict):
        # Force immediate emission without buffering
        if event == "llm_streaming_token":
            print(f"[DEBUG] Emitting token for session {sid}: '{payload.get('token', '')[:20]}...'")
        elif event == "code_check_streaming_token":
            print(f"[DEBUG] Emitting code reviewer token for session {sid}: '{payload.get('token', '')[:20]}...'")
        else:
            print(f"[DEBUG] Emitting {event} for session {sid}")
        socketio.emit(event, payload, room=sid)
        # Force flush the socket
        socketio.sleep(0)  # This forces Flask-SocketIO to flush immediately

    cb = dict(
        # progress
        on_step_update=lambda step, msg, iteration=None, prompt_details=None, **_: _emit(
            "step_update", dict(step=step, message=msg, iteration=iteration, prompt_details=prompt_details)
        ),

        # streaming
        on_llm_streaming_start=lambda it, m: _emit(
            "llm_streaming_start", dict(iteration=it, model_name=generator_model_name)
        ),
        on_llm_streaming_token=lambda tok, it, m: _emit(
            "llm_streaming_token", dict(token=tok, iteration=it, model_name=generator_model_name)
        ),
        on_llm_streaming_end=lambda it, m: _emit(
            "llm_streaming_end", dict(iteration=it, model_name=generator_model_name)
        ),

        # code reviewer streaming
        on_code_check_streaming_start=lambda it, m: _emit(
            "code_check_streaming_start", dict(iteration=it, model_name=critic_model_name)
        ),
        on_code_check_streaming_token=lambda tok, it, m: _emit(
            "code_check_streaming_token", dict(token=tok, iteration=it, model_name=critic_model_name)
        ),
        on_code_check_streaming_end=lambda it, m: _emit(
            "code_check_streaming_end", dict(iteration=it, model_name=critic_model_name)
        ),

        # code execution lifecycle
        on_code_execution_start=lambda it: _emit(
            "code_execution_start", dict(iteration=it)
        ),
        on_code_execution_end=lambda it: _emit(
            "code_execution_end", dict(iteration=it)
        ),
        on_code_execution=lambda it, out, stdout, err: _emit(
            "code_execution",
            dict(iteration=it, output=str(out), stdout=stdout, error=err),
        ),

        # Legacy on_code_check callback removed - now using streaming only

        on_error=lambda msg: _emit("solving_error", dict(error=msg)),

        # interruption / limits
        check_interrupted=stop_evt.is_set,
        get_max_execution_time=lambda: max_exec,
        
        # interactive mode callback
        on_waiting_for_user=lambda iteration, critic_text, code, symbols: _emit(
            "awaiting_user_feedback", 
            dict(iteration=iteration, critic_text=critic_text, code=code, symbols=_safe(symbols))
        ),
    )
    return cb


# ========== routes =================================================================

@app.route("/")
def index():
    return render_template(
        "index_modular.html",
        available_models=AVAILABLE_MODELS,
        default_settings=DEFAULT_SETTINGS,
    )


# ========== socket events ===========================================================

@socketio.on("connect")
def on_connect():
    sid = request.sid
    sessions[sid] = dict(settings=DEFAULT_SETTINGS.copy(), chat=[])
    emit("session_connected", {"session_id": sid})
    print(f"[CONNECT] {sid}")


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    if sid in active_tasks:
        active_tasks[sid]["event"].set()
        active_tasks.pop(sid, None)
    sessions.pop(sid, None)
    print(f"[DISCONNECT] {sid}")


@socketio.on("update_settings")
def on_update_settings(data):
    sid = request.sid
    if sid not in sessions:
        emit("settings_updated", {"status": "error", "message": "No session"})
        return

    sessions[sid]["settings"].update(data)
    emit("settings_updated", {"status": "success", "settings": sessions[sid]["settings"]})


@socketio.on("solve_problem")
def on_solve_problem(data):
    sid = request.sid
    if sid not in sessions:
        emit("solving_error", {"error": "Session vanished"})
        return

    text = (data.get("text") or "").strip()
    if not text:
        emit("solving_error", {"error": "Problem text is empty"})
        return

    img_b64 = data.get("image")
    img = None
    if img_b64 and img_b64.startswith("data:image"):
        try:
            img = base642img(img_b64.split(",", 1)[1])
        except Exception as e:
            emit("solving_error", {"error": f"Bad image: {e}"})
            return

    settings = sessions[sid]["settings"]
    generator_model_id = settings.get("generator_model", settings["model"])
    critic_model_id = settings.get("critic_model", settings["model"])
    pips_mode = settings.get("pips_mode", "AGENT")
    # Handle both new format (global_rules + session_rules) and legacy format (custom_rules)
    global_rules = settings.get("global_rules", "")
    session_rules = settings.get("session_rules", "")
    legacy_custom_rules = settings.get("custom_rules", "")
    
    # Combine rules for the critic
    combined_rules = []
    if global_rules:
        combined_rules.append(f"Global Rules:\n{global_rules}")
    if session_rules:
        combined_rules.append(f"Session Rules:\n{session_rules}")
    if legacy_custom_rules and not global_rules and not session_rules:
        # Backward compatibility
        combined_rules.append(legacy_custom_rules)
    
    custom_rules = "\n\n".join(combined_rules)
    
    print(f"[DEBUG] Custom rules processing for session {sid}:")
    print(f"  Global rules: {repr(global_rules)}")
    print(f"  Session rules: {repr(session_rules)}")
    print(f"  Legacy rules: {repr(legacy_custom_rules)}")
    print(f"  Combined rules: {repr(custom_rules)}")

    # Helper function to get API key for a model
    def get_api_key_for_model(model_id):
        if any(model_id.startswith(model) for model in ["gpt", "o3", "o4"]):
            return settings.get("openai_api_key")
        elif "gemini" in model_id:
            return settings.get("google_api_key")
        elif "claude" in model_id:
            return settings.get("anthropic_api_key")
        return None

    # Validate API key for generator model upfront
    generator_api_key = get_api_key_for_model(generator_model_id)
    critic_api_key = get_api_key_for_model(critic_model_id)
    
    if not generator_api_key:
        emit("solving_error", {"error": f"API key missing for generator model: {generator_model_id}"})
        return

    stop_evt = threading.Event()

    def task():
        try:
            print(f"[DEBUG] Starting solving task for session {sid}")

            sample = RawInput(text_input=text, image_input=img)

            # Instantiate generator model
            generator_model = get_model(generator_model_id, generator_api_key)

            cbs = make_callbacks(
                sid, generator_model_id, critic_model_id, stop_evt, settings["max_execution_time"]
            )

            print(f"[DEBUG] Emitting solving_started for session {sid}")
            socketio.emit("solving_started", {}, room=sid)
            socketio.sleep(0)  # Force flush

            critic_model = generator_model
            if critic_model_id != generator_model_id:
                if critic_api_key:
                    critic_model = get_model(critic_model_id, critic_api_key)
                else:
                    print(f"[DEBUG] Critic API key missing for {critic_model_id}; falling back to generator model for criticism.")

            requested_interactive = (pips_mode == "INTERACTIVE")
            solver = PIPSSolver(
                generator_model,
                max_iterations=settings["max_iterations"],
                temperature=settings["temperature"],
                max_tokens=settings["max_tokens"],
                interactive=requested_interactive,
                critic_model=critic_model,
            )

            decision_max_tokens = min(1024, settings["max_tokens"])
            answer, logs, mode_decision_summary = solver.solve(
                sample,
                stream=True,
                callbacks=cbs,
                additional_rules=custom_rules,
                decision_max_tokens=decision_max_tokens,
                interactive_requested=requested_interactive,
            )

            use_code = mode_decision_summary.get("use_code", False)
            if sid in sessions:
                sessions[sid]["mode_decision"] = mode_decision_summary
            print(
                f"[DEBUG] Mode decision for session {sid}: "
                f"use_code={use_code}, requested_interactive={requested_interactive}"
            )

            if use_code and critic_model_id != generator_model_id and not critic_api_key:
                cbs["on_step_update"](
                    "mode_selection",
                    "Proceeding without a dedicated critic model because no API key was provided.",
                    iteration=None,
                )

            if use_code:
                print(f"[DEBUG] Used iterative code path for session {sid}")
                # If interactive mode returned early (waiting for user), store solver in session
                if requested_interactive and not answer and solver._checkpoint:
                    if sid in sessions:
                        sessions[sid]["solver"] = solver
                    print(f"[DEBUG] Interactive mode - waiting for user feedback for session {sid}")
                    return
            else:
                print(f"[DEBUG] Used chain-of-thought path for session {sid}")

            if stop_evt.is_set():
                print(f"[DEBUG] Task was interrupted for session {sid}")
                socketio.emit("solving_interrupted", {"message": "Interrupted"}, room=sid)
                return

            print(f"[DEBUG] Solving completed, emitting final answer for session {sid}")

            if not isinstance(logs, dict) or logs is None:
                logs = {}  # ensure logs is a dict for augmentation
            if isinstance(logs, dict):
                logs.setdefault("mode_decision", mode_decision_summary)

            # Extract final artifacts for display
            latest_symbols = logs.get("all_symbols", [])[-1] if logs.get("all_symbols") else {}
            latest_code = logs.get("all_programs", [])[-1] if logs.get("all_programs") else ""
            
            # Emit final artifacts
            socketio.emit("final_artifacts", {
                "symbols": _safe(latest_symbols),
                "code": latest_code
            }, room=sid)
            
            socketio.emit(
                "solving_complete",
                {
                    "final_answer": answer,
                    "logs": _safe(logs),
                    "method": "iterative_code" if use_code else "chain_of_thought",
                },
                room=sid,
            )
            if sid in sessions:
                sessions[sid].pop("mode_decision", None)

        except Exception as exc:
            print(f"[DEBUG] Exception in solving task for session {sid}: {exc}")
            if sid in sessions:
                sessions[sid].pop("mode_decision", None)
            socketio.emit("solving_error", {"error": str(exc)}, room=sid)
        finally:
            print(f"[DEBUG] Cleaning up task for session {sid}")
            active_tasks.pop(sid, None)

    active_tasks[sid] = dict(event=stop_evt, task=socketio.start_background_task(task))


@socketio.on("interrupt_solving")
def on_interrupt(data=None):
    sid = request.sid
    if sid in active_tasks:
        active_tasks[sid]["event"].set()
        emit("solving_interrupted", {"message": "Stopped."})
    else:
        emit("solving_interrupted", {"message": "No active task."})


@socketio.on("provide_feedback")
def on_provide_feedback(data):
    """Handle user feedback in interactive mode."""
    sid = request.sid
    if sid not in sessions:
        emit("solving_error", {"error": "Session vanished"})
        return
    
    solver = sessions[sid].get("solver")
    if not solver or not solver._checkpoint:
        emit("solving_error", {"error": "No interactive session waiting for feedback"})
        return
    
    # Extract user feedback
    user_feedback = {
        "accept_critic": data.get("accept_critic", True),
        "extra_comments": data.get("extra_comments", ""),
        "quoted_ranges": data.get("quoted_ranges", []),
        "terminate": data.get("terminate", False)
    }
    
    def continue_task():
        try:
            print(f"[DEBUG] Continuing interactive task with user feedback for session {sid}")
            
            # Continue from checkpoint with user feedback
            answer, logs = solver.continue_from_checkpoint(user_feedback)

            mode_decision = sessions[sid].get("mode_decision") or getattr(solver, "_mode_decision_summary", None)
            if not isinstance(logs, dict) or logs is None:
                logs = {}
            if isinstance(logs, dict) and mode_decision:
                logs.setdefault("mode_decision", mode_decision)
            
            # Extract final artifacts
            latest_symbols = logs.get("all_symbols", [])[-1] if logs.get("all_symbols") else {}
            latest_code = logs.get("all_programs", [])[-1] if logs.get("all_programs") else ""
            
            # Emit final artifacts
            socketio.emit("final_artifacts", {
                "symbols": _safe(latest_symbols),
                "code": latest_code
            }, room=sid)
            
            # Emit completion
            socketio.emit("solving_complete", {
                "final_answer": answer,
                "logs": _safe(logs),
                "method": "iterative_code_interactive",
            }, room=sid)
            sessions[sid].pop("mode_decision", None)
            
        except Exception as exc:
            print(f"[DEBUG] Exception in interactive continuation for session {sid}: {exc}")
            socketio.emit("solving_error", {"error": str(exc)}, room=sid)
            if sid in sessions:
                sessions[sid].pop("mode_decision", None)
        finally:
            # Clean up
            if sid in sessions:
                sessions[sid].pop("solver", None)
            active_tasks.pop(sid, None)
    
    # Start continuation task
    active_tasks[sid] = dict(event=threading.Event(), task=socketio.start_background_task(continue_task))


@socketio.on("terminate_session")
def on_terminate_session(data=None):
    """Handle user termination of interactive session."""
    sid = request.sid
    if sid not in sessions:
        emit("solving_error", {"error": "Session vanished"})
        return
    
    solver = sessions[sid].get("solver")
    if not solver or not solver._checkpoint:
        emit("solving_error", {"error": "No interactive session to terminate"})
        return
    
    # Terminate with current state
    user_feedback = {"terminate": True}
    
    def terminate_task():
        try:
            print(f"[DEBUG] Terminating interactive task for session {sid}")
            
            # Get final answer from checkpoint
            answer, logs = solver.continue_from_checkpoint(user_feedback)

            mode_decision = sessions[sid].get("mode_decision") or getattr(solver, "_mode_decision_summary", None)
            if not isinstance(logs, dict) or logs is None:
                logs = {}
            if isinstance(logs, dict) and mode_decision:
                logs.setdefault("mode_decision", mode_decision)
            
            # Extract final artifacts
            latest_symbols = logs.get("all_symbols", [])[-1] if logs.get("all_symbols") else {}
            latest_code = logs.get("all_programs", [])[-1] if logs.get("all_programs") else ""
            
            # Emit final artifacts
            socketio.emit("final_artifacts", {
                "symbols": _safe(latest_symbols),
                "code": latest_code
            }, room=sid)
            
            # Emit completion
            socketio.emit("solving_complete", {
                "final_answer": answer,
                "logs": _safe(logs),
                "method": "iterative_code_interactive_terminated",
            }, room=sid)
            sessions[sid].pop("mode_decision", None)
            
        except Exception as exc:
            print(f"[DEBUG] Exception in interactive termination for session {sid}: {exc}")
            socketio.emit("solving_error", {"error": str(exc)}, room=sid)
            if sid in sessions:
                sessions[sid].pop("mode_decision", None)
        finally:
            # Clean up
            if sid in sessions:
                sessions[sid].pop("solver", None)
            active_tasks.pop(sid, None)
    
    # Start termination task
    active_tasks[sid] = dict(event=threading.Event(), task=socketio.start_background_task(terminate_task))


@socketio.on("switch_mode")
def on_switch_mode(data):
    """Handle switching between AGENT and INTERACTIVE modes."""
    sid = request.sid
    if sid not in sessions:
        emit("solving_error", {"error": "Session vanished"})
        return
    
    new_mode = data.get("mode", "AGENT")
    if new_mode not in ["AGENT", "INTERACTIVE"]:
        emit("solving_error", {"error": "Invalid mode"})
        return
    
    # Update session settings
    sessions[sid]["settings"]["pips_mode"] = new_mode
    
    emit("mode_switched", {"mode": new_mode})


@socketio.on("heartbeat")
def on_heartbeat(data):
    emit("heartbeat_response", {"timestamp": data.get("timestamp"), "server_time": time.time()})


@socketio.on("download_chat_log")
def on_download_chat_log():
    sid = request.sid
    sess = sessions.get(sid)
    if not sess:
        emit("error", {"message": "Session missing"})
        return

    payload = dict(
        session_id=sid,
        timestamp=datetime.utcnow().isoformat(),
        settings=_safe(sess["settings"]),
        chat_history=_safe(sess["chat"]),
    )
    emit(
        "chat_log_ready",
        {
            "filename": f"pips_chat_{sid[:8]}.json",
            "content": json.dumps(payload, indent=2),
        },
    )


# ========== public runner ==========================================================

def run_app(host: str = "0.0.0.0", port: int = 8080, debug: bool = False):
    os.makedirs("uploads", exist_ok=True)   # if you later add upload support
    socketio.run(app, host=host, port=port, debug=debug)


# ---------------------------------------------------------------------
if __name__ == "__main__":       # script usage: python pips/web_app.py --port 5000
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()
    run_app(args.host, args.port, args.debug)
