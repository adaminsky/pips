"""
PIPS: Per-Instance Program Synthesis

A library for per-instance adaptive reasoning that alternates between chain-of-thought
deliberation and executable program synthesis.
"""

__version__ = "1.0.0"

from .core import PIPSSolver, PIPSMode
from .models import get_model
from .model_registry import register_model

__all__ = ["PIPSSolver", "PIPSMode", "get_model", "register_model"]
