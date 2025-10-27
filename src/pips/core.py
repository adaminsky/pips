import ast
import re, json
from enum import Enum
from typing import Any, Dict, List, Tuple, Optional, Callable
from .utils import RawInput, img2base64, python_eval
from .models import LLMModel, SamplingParams, OpenAIModel


# ---------------------------------------------------------------------
# PIPSMode enum for agent vs interactive modes
# ---------------------------------------------------------------------
class PIPSMode(Enum):
    AGENT = "AGENT"
    INTERACTIVE = "INTERACTIVE"


# ---------------------------------------------------------------------
# Helper-type aliases
TokenCb = Callable[[str, int, str], None]
CbMap    = Dict[str, Callable[..., Any]]
# ---------------------------------------------------------------------


class PIPSSolver:
    """Per-Instance Program Synthesis (PIPS) solver — unified streaming & non-streaming."""

    def __init__(
    self,
    model: LLMModel,
    *,
    max_iterations: int = 8,
    temperature: float = 0.0,
    max_tokens: int = 4096,
    top_p: float = 1.0,
    interactive: bool = False,
    critic_model: Optional[LLMModel] = None,
    ):
        """
        Args:
            model:        An object that implements .chat(...) and, optionally, .stream_chat(...).
            max_iterations: Maximum refinement loops for the code-generation mode.
            temperature:  Sampling temperature passed to the LLM.
            max_tokens:   Max tokens for each LLM response.
            top_p:        Nucleus-sampling parameter.
            interactive:  Whether to use interactive mode (wait for user feedback).
            critic_model: Optional separate model for criticism (defaults to main model).
        """
        self.model = model
        self.critic_model = critic_model or model
        self.max_iterations = max_iterations
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.top_p = top_p
        self.interactive = interactive
        self._mode_decision_summary: Optional[Dict[str, Any]] = None
        self._last_reasoning_summary: Optional[str] = None
        
        # Interactive mode state
        self._checkpoint = None
        self._current_conversation = None

        # System prompt identical to the original implementation
        self.system_prompt = """You will be given a question and you must answer it by extracting relevant symbols in JSON format and then writing a Python program to calculate the final answer.

You MUST always plan extensively before outputting any symbols or code.

You MUST iterate and keep going until the problem is solved.

# Workflow

## Problem Solving Steps
1. First extract relevant information from the input as JSON. Try to represent the relevant information in as much of a structured format as possible to help with further reasoning/processing.
2. Using the information extracted, determine a reasonable approach to solving the problem using code, such that executing the code will return the final answer.
3. Write a Python program to calculate and return the final answer. Use comments to explain the structure of the code and do not use a main() function.
The JSON must be enclosed in a markdown code block and the Python function must be in a separate markdown code block and be called `solve` and accept a single input called `symbols` representing the JSON information extracted. Do not include any `if __name__ == "__main__"` statement and you can assume the JSON will be loaded into the variable called `symbols` by the user.
The Python code should not just return the answer or perform all reasoning in comments and instead leverage the code itself to perform the reasoning.
Be careful that the code returns the answer as expected by the question, for instance, if the question is multiple choice, the code must return the choice as described in the question.
Be sure to always output a JSON code block and a Python code block.
Make sure to follow these formatting requirements exactly.
"""


    # ========= INTERNAL HELPERS =====================================
    _MODE_SELECTION_LIST_RE = re.compile(r"\[([0-9eE+.\s,-]+)\]")

    def _parse_probability_scores(self, raw: str) -> Optional[List[float]]:
        """Extract a list of 10 probability scores from raw LLM output."""
        if not raw:
            return None

        candidates: List[Any] = []

        try:
            parsed = ast.literal_eval(raw.strip())
            candidates.append(parsed)
        except Exception:
            pass

        for match in self._MODE_SELECTION_LIST_RE.finditer(raw):
            candidate_str = f"[{match.group(1)}]"
            try:
                candidates.append(ast.literal_eval(candidate_str))
            except Exception:
                continue

        for candidate in candidates:
            if (
                isinstance(candidate, list)
                and len(candidate) == 10
                and all(isinstance(x, (int, float)) for x in candidate)
            ):
                floats = [float(x) for x in candidate]
                if all(0.0 <= x <= 1.0 for x in floats):
                    return floats
        return None

    def _build_mode_selection_prompt(self, sample: RawInput) -> List[dict[str, Any]]:
        """Create the conversation for deciding between code and chain-of-thought."""
        from .prompts import CHOOSE_CONSERVATIVE_COT_VS_CODE_PROMPT

        instructions = CHOOSE_CONSERVATIVE_COT_VS_CODE_PROMPT.strip()
        extra_instruction = (
            "\nAt the end of your response, output only the list of 10 probabilities inside square brackets "
            "after the text 'FINAL ANSWER:'."
        )

        content: List[dict[str, Any]] = [{"type": "text", "text": f"{instructions}{extra_instruction}"}]

        if sample.image_input is not None:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{img2base64(sample.image_input)}",
                        "detail": "high",
                    },
                }
            )
        if sample.text_input is not None:
            content.append({"type": "text", "text": f"TARGET QUESTION:\n{sample.text_input}"})

        return [{"role": "user", "content": content}]

    def _summarise_messages_for_log(self, messages: List[dict[str, Any]]) -> List[dict[str, Any]]:
        """Return a copy of the conversation with image payloads redacted for logging."""
        summary: List[dict[str, Any]] = []
        for message in messages:
            content = message.get("content")
            if isinstance(content, list):
                new_content: List[dict[str, Any]] = []
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "image_url":
                        new_content.append({"type": "text", "text": "[image content omitted]"})
                    else:
                        new_content.append(item)
                summary.append({**message, "content": new_content})
            else:
                summary.append(dict(message))
        return summary

    def _decide_solving_mode(
        self,
        messages: List[dict[str, Any]],
        *,
        max_tokens: int,
    ) -> Dict[str, Any]:
        """Run the self-reflection prompt to choose between code and chain-of-thought."""
        sampling_params = SamplingParams(temperature=0.0, max_tokens=max_tokens, top_p=1.0)

        try:
            response = self.model.chat(messages, sampling_params=sampling_params, use_tqdm=False)
        except Exception as exc:
            print(f"[DEBUG] Mode selection prompt raised exception: {exc}. Falling back to chain-of-thought.")
            return {
                "use_code": False,
                "scores": None,
                "average": None,
                "raw_response": "",
                "error": str(exc),
            }

        raw_text = ""
        if response and getattr(response[0], "outputs", None):
            raw_text = response[0].outputs[0].text or ""

        scores = self._parse_probability_scores(raw_text)
        if scores is None:
            print("[DEBUG] Mode selection prompt failed to yield valid probability list; defaulting to chain-of-thought.")
            return {
                "use_code": False,
                "scores": None,
                "average": None,
                "raw_response": raw_text,
                "error": None,
            }

        average = sum(scores) / len(scores)
        use_code = average > 0.5

        return {
            "use_code": use_code,
            "scores": scores,
            "average": average,
            "raw_response": raw_text,
            "error": None,
        }

    def _chat(
        self,
        conversation: List[Dict[str, Any]],
        sampling_params: SamplingParams,
        stream: bool,
        iteration: int,
        callbacks: Optional[CbMap] = None,
    ) -> str:
        """
        Wrapper around model.chat / model.stream_chat that:
        • chooses the right API based on `stream`
        • fires streaming callbacks if supplied
        • returns the full assistant text
        """
        callbacks = callbacks or {}
        self._last_reasoning_summary = None

        # Dummy lambdas so we can call without branch checks later
        on_start   = callbacks.get("on_llm_streaming_start", lambda *a, **k: None)
        on_token   = callbacks.get("on_llm_streaming_token",  lambda *a, **k: None)
        on_end     = callbacks.get("on_llm_streaming_end",    lambda *a, **k: None)
        interrupted = callbacks.get("check_interrupted",      lambda: False)
        on_reasoning_token = callbacks.get("on_llm_reasoning_summary_token", lambda *a, **k: None)
        on_reasoning_end = callbacks.get("on_llm_reasoning_summary_end", lambda *a, **k: None)

        model_name = self.model.__class__.__name__

        if not stream:
            # plain synchronous call
            resp = self.model.chat(conversation, sampling_params=sampling_params, use_tqdm=False)
            text_obj = resp[0].outputs[0]
            summary_attr = getattr(text_obj, "reasoning_summary", None)
            if isinstance(summary_attr, str) and summary_attr.strip():
                summary_text = summary_attr.strip()
                self._last_reasoning_summary = summary_text
                on_reasoning_end(summary_text, iteration, model_name)
            return text_obj.text

        # ---- streaming path ----
        on_start(iteration, model_name)

        def _emit(tok: str):
            if not interrupted():
                on_token(tok, iteration, model_name)

        summary_tokens: List[str] = []
        summary_completed = False

        def _emit_summary(tok: str):
            if not interrupted():
                summary_tokens.append(tok)
                on_reasoning_token(tok, iteration, model_name)

        def _finalise_summary(final_summary: Optional[str]):
            nonlocal summary_completed
            summary_completed = True
            summary_text = final_summary if final_summary is not None else "".join(summary_tokens)
            summary_text = (summary_text or "").strip()
            if summary_text:
                self._last_reasoning_summary = summary_text
            on_reasoning_end(summary_text, iteration, model_name)

        stream_kwargs: Dict[str, Any] = {
            "prompt": conversation,
            "sampling_params": sampling_params,
            "emit_callback": _emit,
            "interrupted_callback": interrupted,
        }

        if isinstance(self.model, OpenAIModel):
            stream_kwargs["reasoning_callback"] = _emit_summary
            stream_kwargs["reasoning_done_callback"] = _finalise_summary

        if hasattr(self.model, "stream_chat"):
            resp = self.model.stream_chat(
                **stream_kwargs,
            )
        else:  # fallback
            resp = self.model.chat(conversation, sampling_params=sampling_params, use_tqdm=False)

        if summary_tokens and not summary_completed:
            _finalise_summary("".join(summary_tokens))

        on_end(iteration, model_name)
        return resp[0].outputs[0].text

    # ---------------------------------------------------------------

    def solve(
        self,
        sample: RawInput,
        *,
        stream: bool = False,
        callbacks: Optional[CbMap] = None,
        additional_rules: str = "",
        decision_max_tokens: int = 1024,
        interactive_requested: bool = False,
    ) -> Tuple[str, Dict[str, Any], Dict[str, Any]]:
        """Automatically choose between chain-of-thought and code-based solving."""
        callbacks = callbacks or {}
        step = callbacks.get("on_step_update", lambda *a, **k: None)

        decision_messages = self._build_mode_selection_prompt(sample)
        decision_prompt_details = {
            "description": "Choosing between chain-of-thought and iterative coding",
            "conversation": self._summarise_messages_for_log(decision_messages),
        }

        step(
            "mode_selection",
            "Choosing between chain-of-thought reasoning and iterative coding…",
            prompt_details=decision_prompt_details,
        )

        decision = self._decide_solving_mode(decision_messages, max_tokens=decision_max_tokens)
        use_code = decision.get("use_code", False)
        average = decision.get("average")
        scores = decision.get("scores")
        decision_error = decision.get("error")

        if scores is None:
            decision_message = "Could not parse confidence scores; defaulting to chain-of-thought reasoning."
        else:
            decision_message = (
                f"Average code suitability score: {average:.2f}. "
                f"Proceeding with {'iterative code generation' if use_code else 'chain-of-thought reasoning'}."
            )

        step(
            "mode_selection",
            decision_message,
            prompt_details={**decision_prompt_details, "raw_response": decision.get("raw_response", ""), "error": decision_error},
        )

        if interactive_requested and not use_code:
            step(
                "mode_selection",
                "Interactive mode requested, but chain-of-thought was selected; running without interactive checkpoints.",
                prompt_details=None,
            )

        mode_decision_summary = {
            "use_code": use_code,
            "scores": scores,
            "average_score": average,
            "raw_response": decision.get("raw_response", ""),
            "prompt": decision_prompt_details["conversation"],
            "error": decision_error,
        }
        self._mode_decision_summary = mode_decision_summary

        original_interactive = self.interactive
        if not use_code:
            self.interactive = False

        try:
            if use_code:
                answer, logs = self.solve_with_code(
                    sample,
                    stream=stream,
                    callbacks=callbacks,
                    additional_rules=additional_rules,
                )
            else:
                answer, logs = self.solve_chain_of_thought(
                    sample,
                    stream=stream,
                    callbacks=callbacks,
                    additional_rules=additional_rules,
                )
        finally:
            self.interactive = original_interactive

        if isinstance(logs, dict):
            logs.setdefault("mode_decision", mode_decision_summary)

        return answer, logs, mode_decision_summary

    def _extract_components(self, output: str) -> Tuple[Any, str, str]:
        """(unchanged helper) extract JSON, code, and reasoning."""
        json_obj, code_str, reasoning = "", "", ""
        try:
            if m := re.findall(r"```json(.*?)```", output, re.DOTALL):
                json_obj = json.loads(m[-1])
        except Exception:
            pass
        try:
            j_end = output.index("```", output.index("```json") + 7) + 3
            p_start = output.index("```python", j_end)
            reasoning = output[j_end:p_start].strip()
        except Exception:
            pass
        try:
            if m := re.findall(r"```python(.*?)```", output, re.DOTALL):
                code_str = m[-1]
        except Exception:
            pass
        return json_obj, code_str, reasoning

    # ========= PUBLIC SOLVERS ======================================

    def solve_chain_of_thought(
        self,
        sample: RawInput,
        *,
        stream: bool = False,
        callbacks: Optional[CbMap] = None,
        additional_rules: str = "",
    ) -> Tuple[str, Dict[str, Any]]:
        """
        One implementation covers both streaming & non-streaming.
        If `stream=True`, supply the standard streaming callbacks.
        """
        callbacks = callbacks or {}
        step = callbacks.get("on_step_update", lambda *a, **k: None)
        logs: Dict[str, Any] = {}

        # Build prompt with additional rules if provided
        system_content = ""
        if additional_rules.strip():
            system_content = f"Additional Requirements:\n{additional_rules.strip()}\n\nMake sure to follow these additional requirements when answering."
            print(f"[DEBUG] Added custom rules to chain of thought prompt: {repr(additional_rules)}")
        
        if sample.image_input is not None:
            img_b64 = img2base64(sample.image_input)
            user_content = [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
                {"type": "text", "text": f"Question: {sample.text_input}"},
                {"type": "text", "text": "Answer step-by-step and finish with 'FINAL ANSWER:'"},
            ]
        else:
            user_content = f"Question: {sample.text_input}\nAnswer step-by-step and finish with 'FINAL ANSWER:'."

        prompt = []
        if system_content:
            prompt.append({"role": "system", "content": system_content})
        prompt.append({"role": "user", "content": user_content})
        params = SamplingParams(self.temperature, self.max_tokens, self.top_p)

        # Create prompt details for chain of thought
        cot_prompt_details = {
            "description": "Chain of thought reasoning",
            "conversation": prompt
        }

        step("reasoning", "Thinking step-by-step...", prompt_details=cot_prompt_details)

        # Call LLM through unified wrapper
        output = self._chat(prompt, params, stream, iteration=0, callbacks=callbacks)
        logs["output"] = output
        if self._last_reasoning_summary:
            logs["reasoning_summary"] = self._last_reasoning_summary

        # Parse FINAL ANSWER (same logic)
        ans = ""
        try:
            ans = re.findall(r"FINAL ANSWER:(.*)", output, re.DOTALL)[-1].strip()
        except Exception:
            pass

        # Check if we were interrupted during processing
        interrupted = callbacks.get("check_interrupted", lambda: False)
        if interrupted():
            step("interrupted", "PIPS was interrupted by the user.", prompt_details=None)
        else:
            step("finished", "Chain of thought completed!", prompt_details=None)
            
        final = f"FINAL ANSWER: {ans}" if ans else output
        logs["final_answer"] = ans
        return final, logs

    # ---------------------------------------------------------------

    def solve_with_code(
        self,
        sample: RawInput,
        *,
        stream: bool = False,
        callbacks: Optional[CbMap] = None,
        additional_rules: str = "",
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Iterative code-generation solver (streaming or not).
        `callbacks` is optional; provide it only when you care about
        fine-grained streaming events.
        Args:
            sample: The raw input containing text and/or image.
            stream: Whether to stream tokens from the underlying LLM.
            callbacks: Optional callback map for streaming & execution events.
            additional_rules: Extra natural-language rules that will be forwarded to the internal code critic for more specialized checking.
        """
        callbacks = callbacks or {}
        interrupted = callbacks.get("check_interrupted", lambda: False)
        step = callbacks.get("on_step_update", lambda *a, **k: None)

        logs = {"all_outputs": [], "all_symbols": [], "all_programs": [], "all_reasoning": []}

        # Abort early?
        if interrupted():
            return "", logs

        # ---- Build initial prompt with custom rules ----
        # Create system prompt with additional rules if provided
        system_content = self.system_prompt
        if additional_rules.strip():
            system_content += f"\n\nAdditional Requirements: \n{additional_rules.strip()}\n\n Make sure to follow these additional requirements when generating your solution."
            print(f"[DEBUG] Added custom rules to initial code generation prompt: {repr(additional_rules)}")
        
        if sample.image_input is not None:
            img_b64 = img2base64(sample.image_input)
            content = [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
                {"type": "text", "text": sample.text_input},
            ]
        else:
            content = sample.text_input

        conv = [
            {"role": "system", "content": system_content},
            {"role": "user",   "content": content},
        ]
        params = SamplingParams(self.temperature, self.max_tokens, self.top_p)

        # Create prompt details for initial generation
        initial_prompt_details = {
            "description": "Initial solution generation",
            "conversation": conv
        }

        step("initial_generation", "Generating first solution…", prompt_details=initial_prompt_details)
        raw = self._chat(conv, params, stream, iteration=0, callbacks=callbacks)
        logs["all_outputs"].append(raw)
        if self._last_reasoning_summary:
            logs.setdefault("reasoning_summaries", []).append(self._last_reasoning_summary)
        conv.append({"role": "assistant", "content": raw})

        # Extract JSON / code / reasoning
        current_symbols, current_code, reasoning = self._extract_components(raw)
        logs["all_symbols"].append(current_symbols)
        logs["all_programs"].append(current_code)
        if reasoning:
            logs["all_reasoning"].append(reasoning)

        # -------- execute & refine up to max_iterations --------
        exec_out, stdout, err = self._run_code(current_symbols, current_code, 0, callbacks, logs)
        for i in range(1, self.max_iterations + 1):
            if interrupted():
                break

            # --- evaluate code quality with prompt details ---
            feedback = self._critic(
                question=sample.text_input,
                code=current_code,
                symbols=current_symbols,
                out=exec_out,
                stdout=stdout,
                err=err,
                params=params,
                additional_rules=additional_rules,
                stream=stream,
                iteration=i,
                callbacks=callbacks,
            )
            # Note: feedback is now displayed via streaming, no need for legacy callback

            # Interactive mode: wait for user feedback if enabled
            if self.interactive:
                print(f"[DEBUG] Interactive mode triggered at iteration {i}")
                # Emit waiting for user feedback event
                on_waiting_for_user = callbacks.get("on_waiting_for_user", lambda *a, **k: None)
                on_waiting_for_user(i, feedback, current_code, current_symbols)
                print(f"[DEBUG] Emitted awaiting_user_feedback event")
                
                # Store checkpoint for later continuation
                self._checkpoint = {
                    "sample": sample,
                    "logs": logs,
                    "conv": conv,
                    "symbols": current_symbols,
                    "code": current_code,
                    "exec_out": exec_out,
                    "stdout": stdout,
                    "err": err,
                    "feedback": feedback,
                    "iteration": i,
                    "params": params,
                    "additional_rules": additional_rules,
                    "stream": stream,
                    "callbacks": callbacks
                }
                
                # Pause here; external caller can resume by invoking continue_from_checkpoint
                return "", logs

            # ask model to improve
            fix_prompt = self._fix_prompt(sample.text_input, current_code, current_symbols, exec_out, stdout, err, feedback)
            conv.append({"role": "user", "content": fix_prompt})

            # Create prompt details for refinement
            refinement_prompt_details = {
                "description": f"Solution refinement (iteration {i})",
                "conversation": conv
            }

            step("refinement", f"Refining solution (iteration {i})...", iteration=i, prompt_details=refinement_prompt_details)
            raw = self._chat(conv, params, stream, iteration=i, callbacks=callbacks)
            logs["all_outputs"].append(raw)
            if self._last_reasoning_summary:
                logs.setdefault("reasoning_summaries", []).append(self._last_reasoning_summary)
            conv.append({"role": "assistant", "content": raw})

            if "FINISHED" in raw:
                break

            # update code / symbols
            new_symbols, new_code, reasoning = self._extract_components(raw)
            if new_symbols:
                current_symbols = new_symbols
                logs["all_symbols"].append(new_symbols)
            if new_code:
                current_code = new_code
                logs["all_programs"].append(new_code)
            if reasoning:
                logs["all_reasoning"].append(reasoning)

            exec_out, stdout, err = self._run_code(current_symbols, current_code, i, callbacks, logs)

        # Check if we were interrupted during processing
        if interrupted():
            step("interrupted", "PIPS was interrupted by the user.", prompt_details=None)
        else:
            step("finished", "Solution completed successfully!", prompt_details=None)
            
        final = f"FINAL ANSWER: {exec_out}"
        return final, logs

    # ========= INTERACTIVE MODE HELPERS ============================
    
    def continue_from_checkpoint(self, user_feedback: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """
        Continue solving from a saved checkpoint with user feedback.
        
        Args:
            user_feedback: Dictionary containing user feedback with keys:
                - accept_critic: bool - whether to accept critic's feedback
                - extra_comments: str - additional user comments
                - quoted_ranges: list - specific code snippets user highlighted
                - terminate: bool - whether user wants to terminate
        
        Returns:
            Final answer and logs
        """
        if not self._checkpoint:
            raise ValueError("No checkpoint available - cannot continue interactive mode")
        
        checkpoint = self._checkpoint
        user_feedback = user_feedback or {}
        
        # Check if user wants to terminate
        if user_feedback.get("terminate", False):
            final = f"FINAL ANSWER: {checkpoint['exec_out']}"
            return final, checkpoint["logs"]
        
        # Merge critic feedback with user feedback
        merged_feedback = self.merge_user_feedback(
            checkpoint["feedback"], 
            user_feedback.get("accept_critic", True),
            user_feedback.get("quoted_ranges", [])
        )
        
        # Check if user provided any feedback
        has_user_feedback = bool(user_feedback.get("quoted_ranges", []))
        
        # Continue the solving process
        current_symbols = checkpoint["symbols"]
        current_code = checkpoint["code"]
        exec_out = checkpoint["exec_out"]
        stdout = checkpoint["stdout"]
        err = checkpoint["err"]

        fix_prompt = self._fix_prompt(
            checkpoint["sample"].text_input,
            current_code,
            current_symbols,
            exec_out,
            stdout,
            err,
            merged_feedback,
            has_user_feedback
        )

        checkpoint["conv"].append({"role": "user", "content": fix_prompt})
        
        # Create prompt details for refinement
        refinement_prompt_details = {
            "description": f"Solution refinement (iteration {checkpoint['iteration']})",
            "conversation": checkpoint["conv"]
        }
        
        step = checkpoint["callbacks"].get("on_step_update", lambda *a, **k: None)
        step("refinement", f"Refining solution (iteration {checkpoint['iteration']})...", 
             iteration=checkpoint['iteration'], prompt_details=refinement_prompt_details)
        
        raw = self._chat(checkpoint["conv"], checkpoint["params"], checkpoint["stream"], 
                        iteration=checkpoint['iteration'], callbacks=checkpoint["callbacks"])
        
        checkpoint["logs"]["all_outputs"].append(raw)
        if self._last_reasoning_summary:
            checkpoint["logs"].setdefault("reasoning_summaries", []).append(self._last_reasoning_summary)
        checkpoint["conv"].append({"role": "assistant", "content": raw})
        
        if "FINISHED" in raw:
            final = f"FINAL ANSWER: {checkpoint['exec_out']}"
            return final, checkpoint["logs"]
        
        # Update code/symbols and continue
        new_symbols, new_code, reasoning = self._extract_components(raw)
        if new_symbols:
            current_symbols = new_symbols
            checkpoint["logs"]["all_symbols"].append(new_symbols)
        if new_code:
            current_code = new_code
            checkpoint["logs"]["all_programs"].append(new_code)
        if reasoning:
            checkpoint["logs"]["all_reasoning"].append(reasoning)
        
        exec_out, stdout, err = self._run_code(current_symbols, current_code, checkpoint['iteration'], 
                                              checkpoint["callbacks"], checkpoint["logs"])
        checkpoint["symbols"] = current_symbols
        checkpoint["code"] = current_code
        checkpoint["exec_out"] = exec_out
        checkpoint["stdout"] = stdout
        checkpoint["err"] = err
        
        # Temporarily disable interactive mode and continue with remaining iterations
        original_interactive = self.interactive
        self.interactive = False
        
        # Continue solving from next iteration
        remaining_iterations = self.max_iterations - checkpoint['iteration']
        if remaining_iterations > 0:
            # Create a new sample with current state
            sample = checkpoint["sample"]
            
            # Continue refinement loop
            for i in range(checkpoint['iteration'] + 1, self.max_iterations + 1):
                interrupted = checkpoint["callbacks"].get("check_interrupted", lambda: False)
                if interrupted():
                    break
                
                feedback = self._critic(
                    question=sample.text_input,
                    code=current_code,
                    symbols=current_symbols,
                    out=exec_out,
                    stdout=stdout,
                    err=err,
                    params=checkpoint["params"],
                    additional_rules=checkpoint["additional_rules"],
                    stream=checkpoint["stream"],
                    iteration=i,
                    callbacks=checkpoint["callbacks"],
                )
                
                fix_prompt = self._fix_prompt(sample.text_input, current_code, current_symbols, exec_out, stdout, err, feedback)
                checkpoint["conv"].append({"role": "user", "content": fix_prompt})
                
                refinement_prompt_details = {
                    "description": f"Solution refinement (iteration {i})",
                    "conversation": checkpoint["conv"]
                }
                
                step("refinement", f"Refining solution (iteration {i})...", 
                     iteration=i, prompt_details=refinement_prompt_details)
                
                raw = self._chat(checkpoint["conv"], checkpoint["params"], checkpoint["stream"], 
                                iteration=i, callbacks=checkpoint["callbacks"])
                
                checkpoint["logs"]["all_outputs"].append(raw)
                if self._last_reasoning_summary:
                    checkpoint["logs"].setdefault("reasoning_summaries", []).append(self._last_reasoning_summary)
                checkpoint["conv"].append({"role": "assistant", "content": raw})
                
                if "FINISHED" in raw:
                    break
                
                new_symbols, new_code, reasoning = self._extract_components(raw)
                if new_symbols:
                    current_symbols = new_symbols
                    checkpoint["logs"]["all_symbols"].append(new_symbols)
                if new_code:
                    current_code = new_code
                    checkpoint["logs"]["all_programs"].append(new_code)
                if reasoning:
                    checkpoint["logs"]["all_reasoning"].append(reasoning)
                
                exec_out, stdout, err = self._run_code(current_symbols, current_code, i, checkpoint["callbacks"], checkpoint["logs"])
                checkpoint["symbols"] = current_symbols
                checkpoint["code"] = current_code
                checkpoint["exec_out"] = exec_out
                checkpoint["stdout"] = stdout
                checkpoint["err"] = err
        
        # Restore interactive mode
        self.interactive = original_interactive
        
        # Clear checkpoint
        self._checkpoint = None
        
        final = f"FINAL ANSWER: {exec_out}"
        return final, checkpoint["logs"]
    
    def merge_user_feedback(self, critic_feedback: str, accept_critic: bool, 
                           quoted_ranges: List[Dict]) -> str:
        """
        Merge critic feedback with user feedback.
        
        Args:
            critic_feedback: Original feedback from the critic
            accept_critic: Whether to include critic's feedback
            quoted_ranges: List of user feedback items (general comments, code feedback, symbol feedback)
        
        Returns:
            Merged feedback string
        """
        feedback_parts = []
        
        if accept_critic and critic_feedback:
            feedback_parts.append("AI Critic's feedback:")
            feedback_parts.append(critic_feedback)
        
        if quoted_ranges:
            # Separate general comments from specific code/symbol feedback
            general_comments = []
            specific_feedback = []
            
            for item in quoted_ranges:
                if not item.get("comment"):
                    continue
                    
                if item.get("type") == "general" or not item.get("text"):
                    general_comments.append(item["comment"])
                else:
                    specific_feedback.append(item)
            
            # Add general user comments
            if general_comments:
                feedback_parts.append("User feedback:")
                feedback_parts.extend(general_comments)
            
            # Add specific code/symbol feedback
            if specific_feedback:
                feedback_parts.append("Specific code feedback:")
                for item in specific_feedback:
                    feedback_parts.append(f"Regarding: {item['text']}")
                    feedback_parts.append(f"Comment: {item['comment']}")
        
        return "\n\n".join(feedback_parts) if feedback_parts else "No specific issues identified."

    # ========= SMALL UTILITY HELPERS (private) =====================

    def _run_code(
        self,
        symbols: Any,
        code: str,
        iteration: int,
        callbacks: CbMap,
        logs: Dict[str, Any],
    ) -> Tuple[str, str, str]:
        """Execute candidate code, emit callbacks, store logs, return (out, stdout, err)."""
        on_exec_start = callbacks.get("on_code_execution_start", lambda *a, **k: None)
        on_exec_end   = callbacks.get("on_code_execution_end",   lambda *a, **k: None)
        on_exec       = callbacks.get("on_code_execution",       lambda *a, **k: None)
        max_time      = callbacks.get("get_max_execution_time",  lambda: 10)()

        on_exec_start(iteration)
        try:
            out, std, err = python_eval(
                f"{code}\nsymbols = {str(symbols)}\nanswer = solve(symbols)",
                max_execution_time=max_time,
            )
        except Exception as e:
            out, std, err = "None", "", str(e)

        on_exec_end(iteration)
        on_exec(iteration, str(out), std, err)
        logs.setdefault("execution_results", []).append({"output": out, "stdout": std, "error": err})
        return str(out), std, err

    # ---------------------------------------------------------------

    def _critic(
        self,
        question: str,
        code: str,
        symbols: Any,
        out: str,
        stdout: str,
        err: str,
        params: SamplingParams,
        additional_rules: str = "",
        stream: bool = False,
        iteration: int = 1,
        callbacks: Optional[CbMap] = None,
    ) -> str:
        """Ask the model to critique the code once per iteration."""
        system_content = f"""You will be given a question and a code solution and you must judge the quality of the code for solving the problem.
                           
Look for any of the following issues in the code:
- The code should be input dependent, meaning it should use the input symbols to compute the answer. It is OK for the code to be specialized to the input (i.e. the reasoning itself may be hardcoded, like a decision tree where the branches are hardcoded).
- The code should not return None unless "None" is the correct answer.
- The code should return the answer, not just print it. If the question asks for a multiple choice answer, the code should return the choice as described in the question.
- There should not be any example usage of the code.
- If there is a simpler way to solve the problem, please describe it.
- If there are any clear bugs in the code which impact the correctness of the answer, please describe them.
- If there are any issues with the extracted symbols, please describe them as well, but separate these issues from the issues with the code.
- If it is possible to sanity check the output of the code, please do so and describe if there are any obvious issues with the output and how the code could be fixed to avoid these issues.

{"Additional issues and specifications to looks for: " if additional_rules else ""}
{additional_rules}

After analyzing the code in depth, output a concrete and concise summary of the issues that are present, do not include any code examples. Please order the issues by impact on answer correctness."""
        
        user_content = f"""Question: {question}

The following are extracted symbols from the question in JSON format followed by a Python program which takes the JSON as an argument called `symbols` and computes the answer.
```json
{json.dumps(symbols, indent=2)}
```

```python
{code}
```

Code execution result:
```
Return value: {out}
Standard output: {stdout}
Exceptions: {err}
```

Output a concrete and concise summary of only the issues that are present, do not include any code examples.
"""
        
        prompt = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]
        
        # Create prompt details for the critic
        critic_prompt_details = {
            "description": f"Code quality analysis and critique (iteration {iteration})",
            "conversation": prompt
        }
        
        # Emit step update with critic prompt details
        callbacks = callbacks or {}
        step = callbacks.get("on_step_update", lambda *a, **k: None)
        step("code_checking", f"Running code critic (iteration {iteration})...", iteration=iteration, prompt_details=critic_prompt_details)
        
        if not stream:
            # Non-streaming path (backward compatibility)
            return self.critic_model.chat(prompt, sampling_params=params, use_tqdm=False)[0].outputs[0].text
        
        # Streaming path for code reviewer
        
        # Create specialized callbacks for code reviewer streaming
        def _make_reviewer_callbacks():
            on_start = callbacks.get("on_code_check_streaming_start", lambda *a, **k: None)
            on_token = callbacks.get("on_code_check_streaming_token", lambda *a, **k: None)
            on_end = callbacks.get("on_code_check_streaming_end", lambda *a, **k: None)
            interrupted = callbacks.get("check_interrupted", lambda: False)
            
            def _emit(tok: str):
                if not interrupted():
                    on_token(tok, iteration, "AI Code Reviewer")
            
            return on_start, on_token, on_end, _emit
        
        on_start, on_token, on_end, _emit = _make_reviewer_callbacks()
        
        # Start streaming
        model_name = "AI Code Reviewer"
        on_start(iteration, model_name)
        
        # Call streaming method
        if hasattr(self.critic_model, "stream_chat"):
            resp = self.critic_model.stream_chat(
                prompt,
                sampling_params=params,
                emit_callback=_emit,
            )
        else:
            # Fallback to regular chat with simulated streaming
            resp = self.critic_model.chat(prompt, sampling_params=params, use_tqdm=False)
        
        on_end(iteration, model_name)
        return resp[0].outputs[0].text

    # ---------------------------------------------------------------

    def _fix_prompt(
        self, question, code, symbols, out, stdout, err, feedback, has_user_feedback=False
    ) -> str:
        """Return the prompt that asks the LLM to fix problems."""
        base_prompt = f"""Please fix the issues with the code and symbols or output "FINISHED".
The following is the result of evaluating the above code with the extracted symbols.
```
Return value: {out}
Standard output: {stdout}
Exceptions: {err}
```

The following is the summary of issues found with the code or the extracted symbols by another model:
```
{feedback}
```
"""
        
        if has_user_feedback:
            emphasis = """
IMPORTANT: The feedback above includes specific user input that you MUST prioritize and address. Pay special attention to any user comments and requirements, as they represent critical guidance from the human user that should take precedence in your solution.
"""
            base_prompt += emphasis
        
        base_prompt += """
If there are any issues which impact the correctness of the answer, please output code which does not have the issues. Before outputting any code, plan how the code will solve the problem and avoid the issues.
If stuck, try outputting different code to solve the problem in a different way.
You may also revise the extracted symbols. To do this, output the revised symbols in a JSON code block. Only include information in the JSON which is present in the original input to keep the code grounded in the specific problem. Some examples of symbol revisions are changing the names of certain symbols, providing further granularity, and adding information which was originally missed.
If everything is correct, output the word "FINISHED" and nothing else.
"""
        return base_prompt
