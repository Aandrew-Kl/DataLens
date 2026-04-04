import "react";

declare module "react" {
  function createElement<P>(
    type: string | JSXElementConstructor<P>,
    props?: Attributes & P | null,
    ...children: unknown[]
  ): ReactElement<P>;
}

declare global {
  interface ReadonlyArray<T> {
    includes(searchElement: T | unknown, fromIndex?: number): boolean;
  }

  interface Array<T> {
    includes(searchElement: T | unknown, fromIndex?: number): boolean;
  }

  interface Set<T> {
    has(value: T | unknown): boolean;
  }

  interface ReadonlySet<T> {
    has(value: T | unknown): boolean;
  }
}
