"""
Prompt templates used by the PIPS solver and interactive interfaces.

These definitions mirror the variants maintained in ``scripts/algorithmic_eval.py``
so that applications embedding the solver can operate when the broader research
repository is not installed as a Python package.
"""

CHOOSE_CONSERVATIVE_COT_VS_CODE_PROMPT = """
You will self-reflect to estimate whether you are more likely to correctly solve a given target question by writing executable Python code or by using chain-of-thought (natural-language) reasoning.

**IMPORTANT:**
- This is a hypothetical evaluation.
- **You must NOT attempt to answer, solve, write code, or reason through the target question yet.**
- Instead, you must reflect carefully and conservatively on your expected ability if you were to attempt solving the question through either method.

Solution Expectations:
- You may assume standard library modules are allowed for code.
- You may NOT call external services, APIs, databases, or other LLMs.
- The code must be self-contained and executable without internet access.
- Chain-of-thought reasoning must be clear, logically sound, and internally verifiable without external tools.

**CRITICAL GUIDANCE:**
- **Be cautious, not optimistic.**  
  Overestimating your capabilities will lead to choosing a method you cannot successfully complete.
- **If you feel any uncertainty, complexity, or ambiguity, lower your probability accordingly.**
- **Assume that even small mistakes can cause failure** when writing code or reasoning through complex tasks.
- **Use conservative estimates.**
- If unsure between two options, **prefer lower probabilities rather than guessing high**.

Here are the self-reflection sub-questions you must answer hypothetically:

1. **Simple Formalizability** — *What is the probability that the full solution can be easily and directly expressed as simple, deterministic code, without needing complex transformations or deep insight?*

2. **Straightforward Executability** — *What is the probability that a first attempt at writing code would execute correctly without needing debugging, even if the problem has subtle or complex aspects?*

3. **Robust Systematic Search** — *What is the probability that coding a systematic method (like brute-force search or recursion) would reliably find the correct answer, without missing hidden constraints or introducing edge-case errors?*

4. **Manageable State Representation** — *What is the probability that all intermediate concepts, variables, and conditions can be simply and explicitly represented in code, without requiring difficult or error-prone state tracking?*

5. **Structured Knowledge Encoding** — *What is the probability that all required background knowledge can be neatly encoded in code (e.g., as rules, formulas, or data), rather than needing flexible, intuitive understanding better suited to reasoning?*

6. **Hallucination Risk Reduction** — *What is the probability that code execution would more reliably avoid fabricated steps or unwarranted assumptions compared to chain-of-thought reasoning?*

7. **Arithmetic and Data Processing Advantage** — *What is the probability that the problem requires extensive or error-prone arithmetic/data handling that code could perform perfectly, but that chain-of-thought would likely fumble?*

8. **Branching and Case Handling Advantage** — *What is the probability that the solution involves many branching conditions, special cases, or exceptions that code can handle systematically but chain-of-thought might overlook?*

9. **Algorithmic Reliability Over Heuristics** — *What is the probability that following a deterministic algorithm in code would reach the correct answer more reliably than relying on intuitive or heuristic chain-of-thought reasoning?*

10. **Overall Comparative Success** — *Considering all factors, what is the probability that code will ultimately produce a correct solution more reliably than chain-of-thought reasoning for this question?*

After thoroughly reasoning through each criterion:

- Output a single list of 10 probability scores (each between 0 and 1) as your FINAL ANSWER, in order:
  - Scores 1–10 correspond to the ten sub-questions above.

**Additional Instructions:**
- Explicitly reason through each criterion carefully before giving a probability.
- If uncertain or if the problem seems complex, favor lower probabilities to reflect the difficulty.
- Make sure to put only the list after FINAL ANSWER.
- **Under no circumstances should you write, sketch, pseudocode, or attempt any part of the solution itself during this reflection phase.**

TARGET QUESTION:
"""

__all__ = ["CHOOSE_CONSERVATIVE_COT_VS_CODE_PROMPT"]
