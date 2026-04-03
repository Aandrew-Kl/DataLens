import React from "react";

const MOTION_PROPS = new Set([
  "animate",
  "exit",
  "initial",
  "layout",
  "layoutId",
  "transition",
  "variants",
  "viewport",
  "whileFocus",
  "whileHover",
  "whileInView",
  "whileTap",
  "drag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "dragTransition",
  "custom",
]);

function omitMotionProps(props: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !MOTION_PROPS.has(key)),
  );
}

function createMotionComponent(tag: string) {
  const MotionComponent = React.forwardRef<HTMLElement, Record<string, unknown>>(
    ({ children, ...props }, ref) =>
      React.createElement(tag as string, { ...omitMotionProps(props), ref }, children as React.ReactNode),
  );

  MotionComponent.displayName = `MockMotion(${
    typeof tag === "string" ? tag : "component"
  })`;

  return MotionComponent;
}

export const motion = new Proxy(
  {},
  {
    get: (_target, tag: string | symbol) => createMotionComponent(String(tag)),
  },
) as Record<string, React.ComponentType<Record<string, unknown>>>;

export function AnimatePresence({
  children,
}: {
  children?: React.ReactNode;
}) {
  return <>{children}</>;
}

export function useReducedMotion() {
  return false;
}

type MotionValueListener = (value: number) => void;

interface MockMotionValue {
  get: () => number;
  set: (value: number) => void;
  on: (event: string, listener: MotionValueListener) => () => void;
}

export function useMotionValue(initialValue: number): MockMotionValue {
  const valueRef = React.useRef(initialValue);
  const listenersRef = React.useRef(new Set<MotionValueListener>());

  return React.useMemo(
    () => ({
      get: () => valueRef.current,
      set: (value: number) => {
        valueRef.current = value;
        listenersRef.current.forEach((listener) => listener(value));
      },
      on: (_event: string, listener: MotionValueListener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [],
  );
}

export function useMotionValueEvent(
  motionValue: MockMotionValue,
  event: string,
  listener: MotionValueListener,
) {
  React.useEffect(() => motionValue.on(event, listener), [event, listener, motionValue]);
}

export function animate(
  motionValue: MockMotionValue,
  value: number,
) {
  motionValue.set(value);
  return {
    stop() {},
  };
}
