import React from "react";

export default function ReactECharts({
  option,
  style,
  onEvents,
}: {
  option?: unknown;
  style?: React.CSSProperties;
  onEvents?: {
    click?: (params: {
      dataType?: string;
      data?: { id?: string };
      name?: string;
    }) => void;
  };
}) {
  return (
    <div>
      <div
        data-testid="echarts"
        data-option={option ? JSON.stringify(option) : ""}
        style={style}
      />
      {onEvents?.click ? (
        <>
          <button
            data-testid="echarts-node-event"
            onClick={() => onEvents.click?.({ dataType: "node", data: { id: "id" }, name: "id" })}
            type="button"
          >
            node
          </button>
          <button
            data-testid="echarts-edge-event"
            onClick={() =>
              onEvents.click?.({
                dataType: "edge",
                data: { id: "customer_id::id" },
                name: "customer_id::id",
              })
            }
            type="button"
          >
            edge
          </button>
        </>
      ) : null}
    </div>
  );
}
