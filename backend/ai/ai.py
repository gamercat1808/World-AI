from groq import Groq
from dotenv import load_dotenv
from pathlib import Path
import os

path = Path ("/home/arthur/Development/World/backend/.env")
load_dotenv(dotenv_path=path)
API_KEY = os.getenv("GROQ_API_KEY")

client = Groq(api_key=API_KEY, timeout=30.0, max_retries=1)

def ask(txt, ido):
    completion = client.chat.completions.create(
    model="openai/gpt-oss-120b",
    messages=[
        {
            "role": "user",
            "content": f"'{txt}'. Responda em {ido}"
        }
        ],
    )
    return completion.choices[0].message.content