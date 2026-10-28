# Dowse for Obsidian

Find anything in your vault by what's in it: notes, PDFs, images, recordings and videos, searched by meaning, on
your computer. Work in progress.

- Runs inside Obsidian: no app or account. Each vault has its own index.
- The model, [EmbeddingGemma 2](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX), is downloaded once
  from Hugging Face when you first turn Dowse on, and runs on your GPU (WebGPU) or processor.
- Desktop only, for now.

## Development

```sh
npm install
npm run build          # main.js
npm run check          # types
npm run measure        # the model builds against the reference vectors (Node)
```

`measurements/` holds what chose the model build.
