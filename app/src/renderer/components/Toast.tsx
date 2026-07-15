/** 2秒で消えるトースト(ソース横断undo等の通知)。 */
import React, { useEffect } from "react";

export function Toast(props: { message: string | null; onDone: () => void }): React.JSX.Element | null {
  const { message, onDone } = props;
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDone, 2000);
    return () => window.clearTimeout(id);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div role="status" style={{
      position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
      background: "#1f242d",
      borderWidth: 1, borderStyle: "solid", borderColor: "#3a4250",
      color: "#e8ebf0", padding: "8px 16px", borderRadius: 8, zIndex: 100, fontSize: 12,
    }}>{message}</div>
  );
}
