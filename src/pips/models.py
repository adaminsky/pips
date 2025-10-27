"""
LLM model interfaces for Per-Instance Program Synthesis (PIPS).

This module provides a unified interface for various LLM providers including
OpenAI, Google Gemini, and Anthropic Claude models.
"""

import os
import time
import json
import re
from openai import OpenAI
from typing import List, Dict, Any, Optional

try:
    import anthropic
except ImportError:
    anthropic = None

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None

from .utils import RawInput, img2base64, base642img


class SamplingParams:
    """
    Sampling parameters for LLM generation.
    
    Args:
        temperature (float): Sampling temperature (0.0 to 2.0)
        max_tokens (int): Maximum number of tokens to generate
        top_p (float): Nucleus sampling parameter
        n (int): Number of completions to generate
        stop (list): List of stop sequences
    """
    def __init__(self, temperature=0.0, max_tokens=4096, top_p=0.9, n=1, stop=None):
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.top_p = top_p
        self.n = n
        self.stop = stop


class LLMModel:
    """
    Base class for LLM models.
    
    Provides a common interface for all LLM providers with lazy initialization
    and both regular and streaming chat capabilities.
    """
    
    def __init__(self, model_name: str):
        self.model_name = model_name
        self._client = None
        self._initialized = False
    
    def _ensure_initialized(self):
        """Ensure the model client is initialized before use."""
        if not self._initialized:
            self._initialize_client()
            self._initialized = True
    
    def _initialize_client(self):
        """Initialize the client - to be implemented by subclasses."""
        raise NotImplementedError
    
    def chat(self, prompt: List[Dict], sampling_params: SamplingParams, use_tqdm=False):
        """
        Generate response using the model.
        
        Args:
            prompt: List of message dictionaries in OpenAI format
            sampling_params: Sampling configuration
            use_tqdm: Whether to show progress bar (unused in base implementation)
            
        Returns:
            List containing Outputs object with generated text
        """
        self._ensure_initialized()
        return self._chat_impl(prompt, sampling_params, use_tqdm)
    
    def _chat_impl(self, prompt: List[Dict], sampling_params: SamplingParams, use_tqdm=False):
        """Actual chat implementation - to be implemented by subclasses."""
        raise NotImplementedError
    
    def stream_chat(self, prompt: List[Dict], sampling_params: SamplingParams, emit_callback=None, interrupted_callback=None):
        """
        Stream response using the model with callback for each token.
        
        Default implementation falls back to regular chat with simulated streaming.
        
        Args:
            prompt: List of message dictionaries in OpenAI format
            sampling_params: Sampling configuration
            emit_callback: Function to call for each generated token
            interrupted_callback: Function to check if streaming should be interrupted
            
        Returns:
            List containing Outputs object with generated text
        """
        # Get the full response
        result = self.chat(prompt, sampling_params, use_tqdm=False)
        full_response = result[0].outputs[0].text
        
        # Simulate streaming by emitting tokens immediately
        if emit_callback and full_response:
            # Split response into reasonable chunks (words/punctuation)
            words = re.findall(r'\S+|\s+', full_response)
            for word in words:
                # Check for interruption before emitting each word
                if interrupted_callback and interrupted_callback():
                    break
                if emit_callback:
                    emit_callback(word)
        
        return result


class OpenAIModel(LLMModel):
    """
    OpenAI GPT model interface.

    Supports GPT-4, GPT-4o, o3, o4, and gpt-5 model families with proper handling
    of different model requirements (reasoning effort for o3/o4 models).
    """
    
    def __init__(self, model_name: str, api_key: Optional[str] = None):
        super().__init__(model_name)
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not provided and OPENAI_API_KEY environment variable not set")
    
    def _initialize_client(self):
        """Initialize OpenAI client with appropriate settings."""
        self._client = OpenAI(
            api_key=self.api_key,
            timeout=900000000,
            max_retries=3,
        )
    
    def _convert_prompt_to_responses_input(self, prompt: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert OpenAI chat-style messages into Responses API input format."""
        formatted: List[Dict[str, Any]] = []
        for message in prompt:
            role = message.get("role", "user")
            content = message.get("content", "")

            parts: List[Dict[str, Any]] = []
            if isinstance(content, str):
                part_type = "output_text" if role == "assistant" else "input_text"
                parts.append({"type": part_type, "text": content})
            elif isinstance(content, list):
                for item in content:
                    item_type = item.get("type")
                    if item_type == "text":
                        part_type = "output_text" if role == "assistant" else "input_text"
                        parts.append({"type": part_type, "text": item.get("text", "")})
                    elif item_type == "image_url":
                        parts.append(
                            {
                                "type": "input_image",
                                "image_url": item.get("image_url", {}),
                            }
                        )
                    else:
                        parts.append(
                            {"type": "input_text", "text": json.dumps(item)}
                        )
            else:
                part_type = "output_text" if role == "assistant" else "input_text"
                parts.append({"type": part_type, "text": str(content)})

            formatted.append({"role": role, "content": parts})
        return formatted
    
    def _create_response_with_retry(self, model, input_messages, max_attempts=5, delay_seconds=2, **kwargs):
        """
        Call responses.create with retry logic.
        """
        if not self._client:
            raise RuntimeError("Client not initialized")

        last_exception = None
        for attempt in range(max_attempts):
            try:
                response = self._client.responses.create(
                    model=model,
                    input=input_messages,
                    **kwargs,
                )
                return response
            except Exception as exc:
                last_exception = exc
                if attempt < max_attempts - 1:
                    time.sleep(delay_seconds)
                else:
                    raise last_exception

        if last_exception:
            raise last_exception
        return None
    
    def _chat_impl(self, prompt: List[Dict], sampling_params: SamplingParams, use_tqdm=False):
        """Implementation of chat for OpenAI models."""
        formatted_prompt = self._convert_prompt_to_responses_input(prompt)
        extra_args: Dict[str, Any] = {}

        if sampling_params.stop:
            extra_args["stop"] = sampling_params.stop

        # Configure parameters based on model type
        if any(tag in self.model_name for tag in ("o3", "o4", "gpt-5")):
            extra_args["reasoning"] = {"effort": "medium"}
            extra_args["max_output_tokens"] = min(sampling_params.max_tokens, 20000)
        else:
            extra_args["max_output_tokens"] = sampling_params.max_tokens
            extra_args["temperature"] = sampling_params.temperature
            extra_args["top_p"] = sampling_params.top_p

        if sampling_params.n and sampling_params.n != 1:
            raise NotImplementedError("OpenAI Responses API does not support n>1 completions.")

        response = self._create_response_with_retry(
            model=self.model_name,
            input_messages=formatted_prompt,
            **extra_args,
        )

        class Outputs:
            def __init__(self, outputs):
                self.outputs = outputs

        class Text:
            def __init__(self, text, reasoning_summary=""):
                self.text = text
                self.reasoning_summary = reasoning_summary

        response_text = getattr(response, "output_text", "") or ""
        reasoning_summary = ""

        reasoning_obj = getattr(response, "reasoning", None)
        if reasoning_obj and hasattr(reasoning_obj, "summary"):
            summary = getattr(reasoning_obj, "summary", None)
            if isinstance(summary, list):
                reasoning_summary = "".join(getattr(item, "text", "") for item in summary).strip()
            elif isinstance(summary, str):
                reasoning_summary = summary.strip()

        return [Outputs([Text(response_text, reasoning_summary)])]

    def stream_chat(
        self,
        prompt: List[Dict],
        sampling_params: SamplingParams,
        emit_callback=None,
        interrupted_callback=None,
        reasoning_callback=None,
        reasoning_done_callback=None,
    ):
        """Stream response using OpenAI's streaming API."""
        self._ensure_initialized()
        return self._stream_chat_impl(
            prompt,
            sampling_params,
            emit_callback,
            interrupted_callback,
            reasoning_callback=reasoning_callback,
            reasoning_done_callback=reasoning_done_callback,
        )
    
    def _stream_chat_impl(
        self,
        prompt: List[Dict],
        sampling_params: SamplingParams,
        emit_callback=None,
        interrupted_callback=None,
        reasoning_callback=None,
        reasoning_done_callback=None,
    ):
        """Implementation of streaming chat for OpenAI models."""
        if not self._client:
            raise RuntimeError("Client not initialized")

        formatted_prompt = self._convert_prompt_to_responses_input(prompt)
        extra_args: Dict[str, Any] = {}

        if sampling_params.stop:
            extra_args["stop"] = sampling_params.stop

        if any(tag in self.model_name for tag in ("o3", "o4", "gpt-5")):
            extra_args["reasoning"] = {"effort": "medium"}
            extra_args["max_output_tokens"] = min(sampling_params.max_tokens, 20000)
        else:
            extra_args["max_output_tokens"] = sampling_params.max_tokens
            extra_args["temperature"] = sampling_params.temperature
            extra_args["top_p"] = sampling_params.top_p

        try:
            stream = self._client.responses.stream(
                model=self.model_name,
                input=formatted_prompt,
                **extra_args,
            )

            full_response = ""
            summary_parts: List[str] = []
            summary_complete = False

            with stream as event_stream:
                for event in event_stream:
                    if interrupted_callback and interrupted_callback():
                        event_stream.close()
                        break

                    event_type = getattr(event, "type", "")

                    if event_type == "response.output_text.delta":
                        token = getattr(event, "delta", "")
                        if token and emit_callback:
                            emit_callback(token)
                        full_response += token or ""
                    elif event_type == "response.reasoning.summary.delta":
                        delta = getattr(event, "delta", None)
                        token = ""
                        if isinstance(delta, str):
                            token = delta
                        elif delta is not None:
                            token = getattr(delta, "text", "") or str(delta)
                        if token:
                            summary_parts.append(token)
                            if reasoning_callback:
                                reasoning_callback(token)
                    elif event_type == "response.reasoning.summary.done":
                        summary_complete = True
                        final_summary = getattr(event, "reasoning_summary", None)
                        summary_text = ""
                        if isinstance(final_summary, str):
                            summary_text = final_summary
                        elif final_summary is not None:
                            summary_text = getattr(final_summary, "text", "") or str(final_summary)
                        if not summary_text:
                            summary_text = "".join(summary_parts)
                        summary_text = summary_text.strip()
                        if reasoning_done_callback:
                            reasoning_done_callback(summary_text)
                        summary_parts = [summary_text] if summary_text else summary_parts
                    elif event_type == "response.completed":
                        # Nothing extra to do; handled after loop
                        pass
                    elif event_type == "response.output_text.done":
                        # Final output text is provided here as convenience
                        output_text = getattr(event, "output_text", None)
                        if output_text:
                            full_response = output_text
                    elif event_type == "response.error":
                        raise RuntimeError(getattr(event, "error", "Unknown error from response stream"))

            if summary_parts and not summary_complete and reasoning_done_callback:
                summary_text = "".join(summary_parts).strip()
                reasoning_done_callback(summary_text)

            class Outputs:
                def __init__(self, outputs):
                    self.outputs = outputs

            class Text:
                def __init__(self, text, reasoning_summary=""):
                    self.text = text
                    self.reasoning_summary = reasoning_summary

            reasoning_summary = "".join(summary_parts).strip()

            return [Outputs([Text(full_response, reasoning_summary)])]

        except Exception as e:
            raise e


class GoogleModel(LLMModel):
    """
    Google Gemini model interface.
    
    Supports both standard Gemini models and code interpreter variants
    through different API endpoints.
    """
    
    def __init__(self, model_name: str, api_key: Optional[str] = None):
        super().__init__(model_name)
        self.api_key = api_key or os.getenv("GOOGLE_API_KEY")
        if not self.api_key:
            raise ValueError("Google API key not provided and GOOGLE_API_KEY environment variable not set")
        
        # Determine which provider to use based on model name
        if "codeinterpreter" in model_name:
            self.provider = "google-genai"
        else:
            self.provider = "google"
    
    def _initialize_client(self):
        """Initialize Google client based on provider type."""
        if self.provider == "google-genai":
            if not genai:
                raise ImportError("google-genai library not installed. Install by running `uv sync` with the appropriate extras.")
            self._client = genai.Client(api_key=self.api_key, http_options=types.HttpOptions(timeout=60*1000))
        else:
            # Use OpenAI-compatible API endpoint
            self._client = OpenAI(
                api_key=self.api_key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                timeout=900000000,
                max_retries=3,
            )
    
    def _chat_impl(self, prompt: List[Dict], sampling_params: SamplingParams, use_tqdm=False):
        """Implementation of chat for Google models."""
        if self.provider == "google-genai":
            return self._chat_genai(prompt, sampling_params)
        else:
            return self._chat_openai_compatible(prompt, sampling_params)
    
    def _chat_genai(self, prompt: List[Dict], sampling_params: SamplingParams):
        """Chat implementation using Google GenAI library."""
        # Convert OpenAI format to Google GenAI format
        genai_contents = []
        for message in prompt:
            role = message["role"]
            content = message["content"]

            if isinstance(content, str):
                genai_contents.append(
                    types.Content(
                        role=role,
                        parts=[types.Part(text=content)]
                    )
                )
            elif isinstance(content, list):
                parts = []
                for item in content:
                    if item["type"] == "text":
                        parts.append(types.Part(text=item["text"]))
                    elif item["type"] == "image_url":
                        img_url = item["image_url"]["url"]
                        if img_url.startswith("data:image"):
                            # Handle base64 encoded images
                            base64_data = img_url.split(",")[1]
                            parts.append(
                                types.Part(
                                    inline_data=types.Blob(
                                        mime_type="image/jpeg",
                                        data=base64_data
                                    )
                                )
                            )
                        else:
                            # Handle image URLs
                            parts.append(
                                types.Part(
                                    file_data=types.FileData(
                                        file_uri=img_url,
                                        mime_type="image/jpeg"
                                    )
                                )
                            )
                if parts:
                    genai_contents.append(
                        types.Content(
                            role=role,
                            parts=parts
                        )
                    )

        response = self._client.models.generate_content(
            model=self.model_name.replace("-codeinterpreter", ""),
            contents=genai_contents,
            config=types.GenerateContentConfig(
                tools=[types.Tool(
                    code_execution=types.ToolCodeExecution
                )],
                temperature=sampling_params.temperature,
                max_output_tokens=sampling_params.max_tokens,
            )
        )
        
        # Process response including code execution results
        response_text = ""
        code_execution_results = []

        if response.candidates is not None:
            for candidate in response.candidates:
                if candidate.content is not None:
                    for part in candidate.content.parts:
                        if part.text is not None:
                            response_text += part.text

                        if part.executable_code is not None:
                            executable_code = part.executable_code
                            if executable_code.code is not None:
                                code_execution_results.append({
                                    'code': executable_code.code,
                                })

                        if part.code_execution_result is not None:
                            code_result = part.code_execution_result
                            if code_result.output is not None:
                                code_execution_results.append({
                                    'output': code_result.output,
                                })

        # Format final response with code execution results
        final_response = ""
        if code_execution_results:
            for result in code_execution_results:
                if "code" in result:
                    final_response += f"Code:\n{result['code']}\n"
                if "output" in result:
                    final_response += f"Output:\n{result['output']}\n"
        final_response += response_text
        
        class Outputs:
            def __init__(self, outputs):
                self.outputs = outputs

        class Text:
            def __init__(self, text):
                self.text = text
        
        return [Outputs([Text(final_response)])]
    
    def _chat_openai_compatible(self, prompt: List[Dict], sampling_params: SamplingParams):
        """Chat implementation using OpenAI-compatible API."""
        response = self._client.chat.completions.create(
            model=self.model_name,
            messages=prompt,
            max_completion_tokens=sampling_params.max_tokens,
            n=sampling_params.n,
            temperature=sampling_params.temperature,
            top_p=sampling_params.top_p,
        )
        
        class Outputs:
            def __init__(self, outputs):
                self.outputs = outputs

        class Text:
            def __init__(self, text):
                self.text = text
        
        if response.usage.completion_tokens > 0:
            return [Outputs([Text(response.choices[i].message.content) for i in range(sampling_params.n)])]
        else:
            return [Outputs([Text("") for i in range(sampling_params.n)])]

    def stream_chat(self, prompt: List[Dict], sampling_params: SamplingParams, emit_callback=None, interrupted_callback=None):
        """Stream response using Google models."""
        self._ensure_initialized()
        return self._stream_chat_impl(prompt, sampling_params, emit_callback, interrupted_callback)
    
    def _stream_chat_impl(self, prompt: List[Dict], sampling_params: SamplingParams, emit_callback=None, interrupted_callback=None):
        """Implementation of streaming chat for Google models."""
        if self.provider == "google-genai":
            return self._stream_chat_genai(prompt, sampling_params, emit_callback, interrupted_callback)
        else:
            return self._stream_chat_openai_compatible(prompt, sampling_params, emit_callback, interrupted_callback)
    
    def _stream_chat_genai(self, prompt: List[Dict], sampling_params: SamplingParams, emit_callback=None, interrupted_callback=None):
        """Stream chat using Google GenAI - simulates streaming as API doesn't support it."""
        # Google GenAI doesn't support streaming yet, so we'll get the full response and simulate streaming
        result = self._chat_genai(prompt, sampling_params)
        full_response = result[0].outputs[0].text
        
        # Simulate streaming by emitting tokens immediately
        if emit_callback and full_response:
            # Split response into reasonable chunks (words/punctuation)
            words = re.findall(r'\S+|\s+', full_response)
            for word in words:
                # Check for interruption before emitting each word
                if interrupted_callback and interrupted_callback():
                    break
                if emit_callback:
                    emit_callback(word)
        
        return result
    
    def _stream_chat_openai_compatible(self, prompt: List[Dict], sampling_params: SamplingParams, emit_callback=None, interrupted_callback=None):
        """Stream chat using OpenAI-compatible Google API."""
        if not self._client:
            raise RuntimeError("Client not initialized")
        
        try:
            stream = self._client.chat.completions.create(
                model=self.model_name,
                messages=prompt,
                max_completion_tokens=sampling_params.max_tokens,
                temperature=sampling_params.temperature,
                top_p=sampling_params.top_p,
                stream=True
            )
            
            full_response = ""
            for chunk in stream:
                # Check for interruption before processing each chunk
                if interrupted_callback and interrupted_callback():
                    break
                    
                if chunk.choices[0].delta.content is not None:
                    token = chunk.choices[0].delta.content
                    full_response += token
                    if emit_callback:
                        emit_callback(token)
            
            # Return in the same format as the non-streaming version
            class Outputs:
                def __init__(self, outputs):
                    self.outputs = outputs

            class Text:
                def __init__(self, text):
                    self.text = text
            
            return [Outputs([Text(full_response)])]
            
        except Exception as e:
            raise e


class AnthropicModel(LLMModel):
    """
    Anthropic Claude model interface.
    
    Supports Claude models with proper message format conversion
    and streaming capabilities.
    """
    
    def __init__(self, model_name: str, api_key: Optional[str] = None):
        super().__init__(model_name)
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError("Anthropic API key not provided and ANTHROPIC_API_KEY environment variable not set")
        
        if not anthropic:
            raise ImportError("anthropic library not installed. Install by running `uv sync` with the appropriate extras.")
    
    def _initialize_client(self):
        """Initialize Anthropic client."""
        self._client = anthropic.Anthropic(api_key=self.api_key)
    
    def _convert_messages(self, prompt: List[Dict]) -> tuple:
        """
        Convert OpenAI format messages to Anthropic format.
        
        Args:
            prompt: List of message dictionaries in OpenAI format
            
        Returns:
            Tuple of (system_message, messages) where messages are in Anthropic format
        """
        system_message = ""
        anthropic_messages = []
        
        for message in prompt:
            role = message["role"]
            content = message["content"]
            
            if role == "system":
                system_message = content if isinstance(content, str) else content[0]["text"]
            else:
                # Convert role names
                if role == "assistant":
                    anthropic_role = "assistant"
                else:
                    anthropic_role = "user"
                
                # Handle content format
                if isinstance(content, str):
                    anthropic_content = content
                elif isinstance(content, list):
                    # Handle multimodal content
                    anthropic_content = []
                    for item in content:
                        if item["type"] == "text":
                            anthropic_content.append({
                                "type": "text",
                                "text": item["text"]
                            })
                        elif item["type"] == "image_url":
                            img_url = item["image_url"]["url"]
                            if img_url.startswith("data:image"):
                                # Extract base64 data and media type
                                header, base64_data = img_url.split(",", 1)
                                media_type = header.split(";")[0].split(":")[1]
                                anthropic_content.append({
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": media_type,
                                        "data": base64_data
                                    }
                                })
                else:
                    anthropic_content = str(content)
                
                anthropic_messages.append({
                    "role": anthropic_role,
                    "content": anthropic_content
                })
        
        return system_message, anthropic_messages
    
    def _chat_impl(self, prompt: List[Dict], sampling_params: SamplingParams, use_tqdm=False):
        """Implementation of chat for Anthropic models."""
        system_message, anthropic_messages = self._convert_messages(prompt)
        
        # Prepare API call arguments
        kwargs = {
            "model": self.model_name,
            "messages": anthropic_messages,
            "max_tokens": sampling_params.max_tokens,
            "temperature": sampling_params.temperature,
            "top_p": sampling_params.top_p,
        }
        
        if system_message:
            kwargs["system"] = system_message
        
        if sampling_params.stop:
            kwargs["stop_sequences"] = sampling_params.stop
        
        response = self._client.messages.create(**kwargs)
        
        # Extract text from response
        response_text = ""
        for content_block in response.content:
            if content_block.type == "text":
                response_text += content_block.text
        
        # Create response wrapper classes
        class Outputs:
            def __init__(self, outputs):
                self.outputs = outputs

        class Text:
            def __init__(self, text):
                self.text = text
        
        return [Outputs([Text(response_text)])]
    
    def stream_chat(self, prompt: List[Dict], sampling_params: SamplingParams, emit_callback=None, interrupted_callback=None):
        """Stream response using Anthropic's streaming API."""
        self._ensure_initialized()
        return self._stream_chat_impl(prompt, sampling_params, emit_callback, interrupted_callback)
    
    def _stream_chat_impl(self, prompt: List[Dict], sampling_params: SamplingParams, emit_callback=None, interrupted_callback=None):
        """Implementation of streaming chat for Anthropic models."""
        if not self._client:
            raise RuntimeError("Client not initialized")
        
        system_message, anthropic_messages = self._convert_messages(prompt)
        
        # Prepare API call arguments
        kwargs = {
            "model": self.model_name,
            "messages": anthropic_messages,
            "max_tokens": sampling_params.max_tokens,
            "temperature": sampling_params.temperature,
            "top_p": sampling_params.top_p,
            "stream": True,
        }
        
        if system_message:
            kwargs["system"] = system_message
        
        if sampling_params.stop:
            kwargs["stop_sequences"] = sampling_params.stop
        
        try:
            full_response = ""
            
            with self._client.messages.stream(**kwargs) as stream:
                for text in stream.text_stream:
                    # Check for interruption before processing each text chunk
                    if interrupted_callback and interrupted_callback():
                        break
                        
                    full_response += text
                    if emit_callback:
                        emit_callback(text)
            
            # Return in the same format as the non-streaming version
            class Outputs:
                def __init__(self, outputs):
                    self.outputs = outputs

            class Text:
                def __init__(self, text):
                    self.text = text
            
            return [Outputs([Text(full_response)])]
            
        except Exception as e:
            raise e


def get_model(model_name: str, api_key: Optional[str] = None) -> LLMModel:
    """
    Factory function to get the appropriate model instance.
    
    Args:
        model_name: Name of the model to instantiate
        api_key: Optional API key (will use environment variable if not provided)
        
    Returns:
        LLMModel instance for the specified model
        
    Raises:
        ValueError: If the model is not supported
    """
    model_name_lower = model_name.lower()

    if any(model_name_lower.startswith(model) for model in ["gpt", "o3", "o4"]):
        return OpenAIModel(model_name, api_key)
    elif "gemini" in model_name_lower:
        return GoogleModel(model_name, api_key)
    elif "claude" in model_name_lower:
        return AnthropicModel(model_name, api_key)
    else:
        raise ValueError(f"Unsupported model: {model_name}")


# Import models from the registry
from .model_registry import get_available_models

# Available models - now pulled from the registry
AVAILABLE_MODELS = get_available_models() 
