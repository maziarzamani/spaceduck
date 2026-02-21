llama-server \
  -m ~/models/llama3.1-8b/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  --ctx-size 8192 \
  -ngl 99