/** Cancellation and worker loss are retryable, never a fault in an original file. */
export class Cancelled extends Error {
  constructor(message = "The model was closed") { super(message); this.name = "Cancelled"; }
}
