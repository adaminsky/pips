"""
Utility functions and data structures for Per-Instance Program Synthesis (PIPS).
"""

from dataclasses import dataclass
from typing import Any, Optional
from io import BytesIO
import base64
import contextlib
import multiprocessing
import timeout_decorator
from io import StringIO
from contextlib import redirect_stdout
from PIL import Image


@dataclass
class RawInput:
    """Dataclass to store raw input for a function."""
    image_input: Optional[Image.Image]
    text_input: Optional[str]


def img2base64(img):
    """Convert PIL Image to base64 string."""
    buffer = BytesIO()
    if img.mode != "RGB":
        img = img.convert("RGB")

    # if width or height < 28, resize it keeping aspect ratio
    if img.width < 28 or img.height < 28:
        # make smallest dimension 28
        new_width = 28
        new_height = 28
        if img.width < img.height:
            new_height = int((28 / img.width) * img.height)
        else:
            new_width = int((28 / img.height) * img.width)
        img = img.resize((new_width, new_height))

    img.save(buffer, format="JPEG")
    return base64.b64encode(buffer.getvalue()).decode()


def base642img(base64_str):
    """Convert base64 string to PIL Image."""
    imgdata = base64.b64decode(base64_str)
    return Image.open(BytesIO(imgdata))


@timeout_decorator.timeout(0.5)
def my_exec(code, locs):
    exec(code, locs, locs)


def run_with_timeout(code, timeout, code_context=None):
    """Execute code with timeout and capture output."""
    def target(queue):
        locs = {}  # Standard dictionary for local variables
        locs["__name__"] = "__main__"
        try:
            if code_context:
                exec(code_context, locs, locs)
        except Exception as e:
            pass

        try:
            # store stdout in a variable
            f = StringIO()
            with redirect_stdout(f):
                exec(code, locs, locs)  # Execute the code with locs as locals
            if "answer" in locs:
                queue.put((locs.get("answer", None), f.getvalue()))  # Retrieve the value of "answer"
            else:
                queue.put((None, f.getvalue()))  # Retrieve the output
        except Exception as e:
            queue.put((f"Error: {e}", f.getvalue()))

    queue = multiprocessing.Queue()  # Queue for communication
    process = multiprocessing.Process(target=target, args=(queue,))
    process.start()
    process.join(timeout)

    if process.is_alive():
        process.terminate()
        process.join()
        return None, "", "Error: Code execution timed out"

    # Retrieve result from the queue
    if not queue.empty():
        result = queue.get()
        answer, stdout = result[0], result[1]
        # Check if the answer indicates an error
        if isinstance(answer, str) and answer.startswith("Error:"):
            return None, stdout, answer  # Return error as the third element
        else:
            return answer, stdout, None  # No error
    return None, "", None


def python_eval(code: str, code_context: str = None, max_execution_time: int = 5):
    """Evaluate Python code and return the result."""
    try:
        if "if __name__ == '__main__'" in code:
            code = code.replace(
                "if __name__ == '__main__':\n    main()",
                "    return answer\nif __name__ == '__main__':\n    answer = main()",
            )
            code = code.replace(
                'if __name__ == "__main__":\n    main()',
                "    return answer\nif __name__ == '__main__':\n    answer = main()",
            )
            code = "answer = None\n" + code
        if "main():" in code:
            code += "\nmain()"
        
        return run_with_timeout(code, max_execution_time, code_context)
    except Exception as e:
        print("Exception:", e)
        return "None", "", str(e)


def eval_extracted_code(code):
    """Evaluate extracted code and return the answer."""
    try:
        locs = {'__name__': '__main__'}
        with contextlib.redirect_stdout(None):
            exec(code, locs, locs)
        return locs["answer"]
    except Exception as e:
        return "None" 
