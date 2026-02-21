# Start a local OpenAI-compatible server with a web UI:
llama-server -hf 

llama-server \
  -hf nomic-ai/nomic-embed-text-v1.5-GGUF:Q5_K_M \
  --host 127.0.0.1 \
  --port 8081 \
  --embeddings