Dowse's reference vectors (`vectors.json`: llama.cpp, EmbeddingGemma 2 Q8, vector version 1) and their inputs, as the
plugin's model gets them: the texts with their prompts (`inputs.json`), the images already sized for their token
budgets the way Dowse sizes them (`screen-280.png`, `landscape-140.png`, `frame-70.png`), and the speech as 16 kHz
mono samples (`speech-16k.f32`, little-endian float32). The plugin's vectors are checked against them.

The landscape and application screen are original synthetic illustrations, not
downloaded photographs. The speech was generated with local Windows speech
synthesis. `frame-70.png` is a second token-budget rendering of the same drawn
landscape. These inputs contain no private user recordings or documents.
