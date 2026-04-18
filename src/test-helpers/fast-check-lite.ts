type Arbitrary<T> = {
  generate: (rng: Random) => T;
  map: <U>(project: (value: T) => U) => Arbitrary<U>;
};

type PropertyOptions = {
  numRuns?: number;
  seed?: number;
};

type Property = {
  run: (options?: PropertyOptions) => Promise<void>;
};

const DEFAULT_NUM_RUNS = 100;
const DEFAULT_SEED = 0x1a2b3c4d;

class Random {
  constructor(private state: number) {}

  next(): number {
    let value = this.state | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value;
    return (value >>> 0) / 0x100000000;
  }

  integer(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(values: readonly T[]): T {
    return values[this.integer(0, values.length - 1)];
  }
}

const TEXT_CHARSET = [
  "",
  ",",
  "\n",
  "\r",
  "\t",
  "\"",
  "'",
  "\\",
  "\0",
  "a",
  "Z",
  "0",
  "9",
  " ",
  "-",
  "_",
  ".",
  ":",
  ";",
  "|",
  "/",
  "?",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "=",
  "+",
  "λ",
  "ß",
  "中",
  "😀",
  "\u2028",
  "\u2029",
] as const;

function createArbitrary<T>(generate: (rng: Random) => T): Arbitrary<T> {
  return {
    generate,
    map<U>(project: (value: T) => U): Arbitrary<U> {
      return createArbitrary((rng) => project(generate(rng)));
    },
  };
}

export function constant<T>(value: T): Arbitrary<T> {
  return createArbitrary(() => value);
}

export function string(options: { minLength?: number; maxLength?: number } = {}): Arbitrary<string> {
  const minLength = options.minLength ?? 0;
  const maxLength = options.maxLength ?? 64;

  return createArbitrary((rng) => {
      const length = rng.integer(minLength, maxLength);
      let value = "";
      for (let index = 0; index < length; index += 1) {
        value += rng.pick(TEXT_CHARSET);
      }
      return value;
    });
}

export function uint8Array(options: { minLength?: number; maxLength?: number } = {}): Arbitrary<Uint8Array> {
  const minLength = options.minLength ?? 0;
  const maxLength = options.maxLength ?? 512;

  return createArbitrary((rng) => {
      const length = rng.integer(minLength, maxLength);
      const value = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        value[index] = rng.integer(0, 255);
      }
      return value;
    });
}

export function oneof<T>(...arbitraries: Arbitrary<T>[]): Arbitrary<T> {
  return createArbitrary((rng) => rng.pick(arbitraries).generate(rng));
}

export function property<T>(
  arbitrary: Arbitrary<T>,
  predicate: (value: T) => void | Promise<void>
): Property {
  return {
    run: async (options = {}) => {
      const rng = new Random(options.seed ?? DEFAULT_SEED);
      const numRuns = options.numRuns ?? DEFAULT_NUM_RUNS;

      for (let run = 0; run < numRuns; run += 1) {
        await predicate(arbitrary.generate(rng));
      }
    },
  };
}

export async function assert(propertyUnderTest: Property, options?: PropertyOptions): Promise<void> {
  await propertyUnderTest.run(options);
}
