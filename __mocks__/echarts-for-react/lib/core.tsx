import React from "react";

export default React.forwardRef(function MockChart(
  props: Record<string, unknown>,
  _ref: React.Ref<unknown>,
) {
  return React.createElement("div", {
    "data-testid": "echart",
    "data-option": JSON.stringify(props.option ?? null),
    style: props.style as React.CSSProperties | undefined,
  });
});
