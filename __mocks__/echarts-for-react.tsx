import React from "react";

export default function ReactECharts({
  option,
  style,
}: {
  option?: unknown;
  style?: React.CSSProperties;
}) {
  return (
    <div
      data-testid="echarts"
      data-option={option ? JSON.stringify(option) : ""}
      style={style}
    />
  );
}
