"""
Model registry for Per-Instance Program Synthesis (PIPS) - centralized model management.

This module provides a pluggable model registry that makes it easy to add
new models from different providers without modifying the core codebase.
"""

from typing import Dict, Any, Optional

# Internal registry storage
_registry: Dict[str, Dict[str, Any]] = {}

def register_model(name: str, provider: str, display: str = "", **config):
    """
    Register a new model in the registry.
    
    Args:
        name: Unique model identifier
        provider: Provider name (openai, google, anthropic)
        display: Human-readable display name
        **config: Additional configuration parameters
    """
    _registry[name] = {
        "provider": provider,
        "display": display or name,
        **config
    }

def list_models() -> Dict[str, Dict[str, Any]]:
    """
    Get all registered models.
    
    Returns:
        Dictionary mapping model names to their configuration
    """
    return _registry.copy()

def get_model_config(name: str) -> Optional[Dict[str, Any]]:
    """
    Get configuration for a specific model.
    
    Args:
        name: Model identifier
        
    Returns:
        Model configuration or None if not found
    """
    return _registry.get(name)

def get_available_models() -> Dict[str, str]:
    """
    Get available models in the format expected by the UI.
    
    Returns:
        Dictionary mapping model IDs to display names
    """
    return {name: config["display"] for name, config in _registry.items()}

# Initialize with default models
def _initialize_default_models():
    """Initialize the registry with default models."""
    
    # OpenAI Models
    register_model("gpt-4.1-2025-04-14", "openai", "OpenAI GPT-4.1")
    register_model("gpt-4o-2024-08-06", "openai", "OpenAI GPT-4o")
    register_model("gpt-4.1-mini-2025-04-14", "openai", "OpenAI GPT-4.1 Mini")
    register_model("gpt-4o-mini", "openai", "OpenAI GPT-4o Mini")
    register_model("o4-mini-2025-04-16", "openai", "OpenAI o4 Mini")
    register_model("o3-2025-04-16", "openai", "OpenAI o3")
    
    # Google Models
    register_model("gemini-2.0-flash", "google", "Google Gemini 2.0 Flash")
    register_model("gemini-2.0-flash-codeinterpreter", "google", "Google Gemini 2.0 Flash (Code Interpreter)")
    
    # Anthropic Models
    register_model("claude-sonnet-4-20250514", "anthropic", "Anthropic Claude 4 Sonnet")
    register_model("claude-opus-4-20250514", "anthropic", "Anthropic Claude 4 Opus")
    register_model("claude-3-5-haiku-latest", "anthropic", "Anthropic Claude 3.5 Haiku")

# Initialize default models when module is imported
_initialize_default_models() 
