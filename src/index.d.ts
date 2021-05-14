
/// <reference types="node" />

export interface Options {
  objectMode: boolean;
  order: boolean;
  tasks: number;
}

/**
 * If returned by the map function, will skip this item in the final output.
 */
export const skip: Symbol;

/**
 * Build a mapping stream. This runs in parallel over receved chunks.
 *
 * Unlike the built-in Array.map function, returning null or undefined from the mapper will push
 * the same chunk onto the output. This acts more like forEach.
 *
 * By default, this operates in objectMode, and does not guarantee that the output order matches
 * the input order.
 */
export function map(handler: (arg: any, index: number) => any, options?: Partial<Options>): stream.Transform;

/**
 * As per map, but returning falsey values will remove this from the stream. Returning a truthy
 * value will include it.
 */
export function filter(handler: (arg: any, index: number) => boolean|Promise<boolean>, options?: Partial<Options>): stream.Transform;

/**
 * Asynchronously process all data passed through this stream prior to 'flush' being invoked. This
 * gates the throughput and pushes the array of returned values.
 *
 * This assumes object mode and does not validate or check encoding.
 */
export function gate(handler: (arg: any[]) => Iterable<any>|Promise<Iterable<any>>): stream.Transform;

/**
 * Returns a helper transform that generates an Array from piped data.
 */
export function toArray(): {stream: stream.Transform, promise: Promise<any[]>};
