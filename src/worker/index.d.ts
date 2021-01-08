

export interface PoolOptions {
  /**
   * Maximum number of tasks to use. Default is 75% of your CPU count, rounded up, with a minimum
   * of one.
   */
  tasks?: number,

  /**
   * Kill an inactive task after this amount of time. Default is zero (but will be reused if
   * there's immediately pending tasks), increase if your tasks have high setup costs.
   */
  expiry?: number,
}

/**
 * @param dep to run script from
 * @param options
 * @return callable to add work
 */
export function pool(dep: string, options?: PoolOptions): (...any) => Promise<any>;
