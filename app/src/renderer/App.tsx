import React from "react";

export function App(): React.JSX.Element {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <div style={{ textAlign: "center", opacity: 0.8 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>BeatMarks</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          音声・動画ファイルをここにドロップ(Task 8 で実装)
        </div>
      </div>
    </div>
  );
}
