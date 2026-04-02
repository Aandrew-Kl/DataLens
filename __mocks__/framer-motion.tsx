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
