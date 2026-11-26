/**
 * The on-device model's engine (WebLLM), in a worker of its own. llmService.ts starts it and drives it with
 * CreateWebWorkerMLCEngine.
 *
 * The worker used to be a string made into a blob: URL whose first line imported the engine from a CDN, with
 * no version in the URL: every load ran whatever release the CDN served that day against the page side's
 * pinned one, and when the CDN failed or was blocked, On-device had no engine. Now Vite bundles
 * @mlc-ai/web-llm into this worker at the version in pnpm-lock.yaml, the same copy the page side imports, and
 * the browser loads it from the app's own origin like the rest of the app.
 *
 * What it still fetches when a model loads is the model, from the hosts in web-llm's prebuilt model list:
 * the weights from huggingface.co/mlc-ai, and the model's compiled WebGPU library (one .wasm per model) from
 * raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()

self.onmessage = (message: MessageEvent) => {
  handler.onmessage(message)
}
