/** Replaceable random source. Implementations must return values in [0, 1). */
export interface RandomSource {
  next(): number;
}

/** 生产环境随机源适配器；业务代码只通过 `RandomSource` 使用随机，测试注入确定性序列。 */
export function createSystemRandomSource(): RandomSource {
  return {
    next: (): number => Math.random(),
  };
}

